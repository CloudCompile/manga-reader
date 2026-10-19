// The anime integration parses loosely typed upstream JSON, matches a manga
// title to an anime, and rewrites HLS playlists so the player stays on our
// origin. All three are pure functions, so they are exercised here against
// representative payloads rather than a live API.
import {
  parseSearchItem,
  parseAnimeInfo,
  parseEpisodes,
  parseStream,
  titleSimilarity,
  rewritePlaylist,
  isPlaylist,
} from "../src/lib/anime.ts";
import { okPublicUrl, isPrivateHost } from "../src/lib/net.ts";
import { assert, assertEqual, suite, test } from "./harness.ts";

export async function run(): Promise<void> {
  suite("anime");

  await test("parseSearchItem keeps the fields the picker shows", () => {
    const r = parseSearchItem({
      id: "naruto-76396",
      title: "Naruto",
      japanese_title: "ナルト",
      poster: "https://cdn/x.jpg",
      tvInfo: { showType: "TV", sub: "220", dub: "220" },
    });
    assert(r !== null, "a well-formed item should parse");
    assertEqual(r!.id, "naruto-76396", "id");
    assertEqual(r!.title, "Naruto", "title");
    assertEqual(r!.japaneseTitle, "ナルト", "japanese title");
    assertEqual(r!.showType, "TV", "show type should fall back to tvInfo");
    assertEqual(r!.subEpisodes, "220", "sub episode count");
  });

  await test("parseSearchItem drops an item with no id or title", () => {
    assertEqual(parseSearchItem({ title: "No id" }), null, "missing id should drop the item");
    assertEqual(parseSearchItem({ id: "x" }), null, "missing title should drop the item");
  });

  await test("parseAnimeInfo flattens the nested animeInfo block", () => {
    const info = parseAnimeInfo({
      id: "naruto-76396",
      title: "Naruto",
      animeInfo: {
        Overview: "A ninja.",
        Status: "Finished",
        Genre: ["Action", "Adventure"],
        Studios: ["Pierrot"],
        Premiered: ["Fall 2002"],
        tvInfo: { sub: "220", dub: "220" },
      },
    });
    assert(info !== null, "a well-formed info should parse");
    assertEqual(info!.overview, "A ninja.", "overview");
    assertEqual(info!.genres.join(","), "Action,Adventure", "genres");
    assertEqual(info!.studios.join(","), "Pierrot", "studios");
    assertEqual(info!.premiered, "Fall 2002", "premiered is taken from the list");
    assertEqual(info!.dubEpisodes, "220", "dub count");
  });

  await test("parseAnimeInfo tolerates a missing animeInfo block", () => {
    const info = parseAnimeInfo({ id: "x", title: "Bare" });
    assert(info !== null, "a title alone is enough");
    assertEqual(info!.genres.length, 0, "genres default to empty");
    assertEqual(info!.adult, false, "adult defaults to false");
  });

  await test("parseEpisodes sorts ascending and coerces the number", () => {
    const eps = parseEpisodes([
      { id: "s?ep=1_2", episode_no: "2", title: "Two" },
      { id: "s?ep=1_1", episode_no: 1, title: "One" },
      { id: "s?ep=1_x", episode_no: "not-a-number" },
    ]);
    assertEqual(eps.length, 2, "the unparseable episode should be dropped");
    assertEqual(eps[0].num, 1, "episodes should be sorted ascending");
    assertEqual(eps[1].num, 2, "second episode");
    assertEqual(eps[0].title, "One", "title");
  });

  await test("parseEpisodes gives a filler episode a sensible default title", () => {
    const eps = parseEpisodes([{ id: "s?ep=1_7", episode_no: 7, filler: true, dubbed: true }]);
    assertEqual(eps[0].title, "Episode 7", "a missing title is synthesised");
    assert(eps[0].filler, "filler flag");
    assert(eps[0].dubbed, "dub flag");
    assert(eps[0].subbed, "sub is assumed unless explicitly false");
  });

  await test("parseStream prefers an HLS playlist over an iframe", () => {
    const s = parseStream({
      streamingLink: {
        server: "Vidplay",
        link: { file: "https://cdn/master.m3u8", type: "hls" },
        iframe: "https://embed/x",
      },
      servers: [
        { type: "sub", serverName: "Vidplay" },
        { type: "dub", serverName: "BYFMS" },
        { type: "sub", serverName: "Vidplay" },
      ],
    });
    assert(s !== null, "a stream should parse");
    assertEqual(s!.kind, "hls", "the playlist should win");
    assertEqual(s!.url, "https://cdn/master.m3u8", "playlist url");
    assertEqual(s!.servers.length, 2, "duplicate servers are collapsed");
    assertEqual(s!.servers[1].type, "dub", "the dub server keeps its type");
  });

  await test("parseStream falls back to the iframe when no file is offered", () => {
    const s = parseStream({ streamingLink: { iframe: "https://embed/x" } });
    assertEqual(s!.kind, "iframe", "the iframe is the only option");
    assertEqual(s!.url, "https://embed/x", "iframe url");
  });

  await test("parseStream reports an empty playlist when nothing is playable", () => {
    const s = parseStream({ streamingLink: {} });
    assertEqual(s!.kind, "hls", "the shape stays consistent");
    assertEqual(s!.url, "", "no url");
  });

  await test("titleSimilarity is exact on a normalised match", () => {
    assertEqual(titleSimilarity("Naruto", "naruto"), 1, "case and punctuation are ignored");
    assertEqual(titleSimilarity("Attack on Titan", "Attack on Titan!"), 1, "punctuation is ignored");
  });

  await test("titleSimilarity scores partial overlap below exact", () => {
    const partial = titleSimilarity("Blue Box", "Blue Box Season 2");
    assert(partial > 0.5 && partial < 1, `partial overlap should sit between, got ${partial}`);
    assertEqual(titleSimilarity("Naruto", "Berserk"), 0, "unrelated titles share nothing");
    assert(
      titleSimilarity("The Fragrant Flower Blooms with Dignity", "Fragrant Flower Blooms") >= 0.6,
      "a prefix relationship should clear the match threshold"
    );
  });

  await test("titleSimilarity ignores accents and non-Latin suffixes", () => {
    assertEqual(titleSimilarity("Kimi ni Todoke", "Kimi ni Todoke"), 1, "identical");
    assertEqual(titleSimilarity("Pokémon", "Pokemon"), 1, "the accent is stripped");
  });

  await test("rewritePlaylist relays child URIs and keeps tags", () => {
    const body = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"",
      "#EXTINF:10.0,",
      "seg1.ts",
      "#EXTINF:10.0,",
      "https://cdn/abs/seg2.ts",
    ].join("\n");
    const out = rewritePlaylist(body, "https://cdn/path/master.m3u8");
    assert(out.startsWith("#EXTM3U"), "the header is preserved");
    assert(out.includes("#EXT-X-VERSION:3"), "plain tags pass through");
    assert(out.includes("URI=\"/api/anime/hls?url="), "the key URI is relayed");
    assert(out.includes("/api/anime/hls?url=https%3A%2F%2Fcdn%2Fpath%2Fseg1.ts"), "a relative segment resolves against the playlist");
    assert(out.includes("/api/anime/hls?url=https%3A%2F%2Fcdn%2Fabs%2Fseg2.ts"), "an absolute segment is relayed");
  });

  await test("isPlaylist reads the body, not the content type", () => {
    assert(isPlaylist("#EXTM3U\n#EXTINF:10,", "image/jpeg"), "the CDN mislabels playlists as images");
    assert(isPlaylist("anything", "application/vnd.apple.mpegurl"), "a mpegurl content type counts");
    assert(!isPlaylist("\x00\x01binary", "image/jpeg"), "a segment body is not a playlist");
  });

  await test("okPublicUrl refuses private hosts and odd schemes", () => {
    assert(okPublicUrl("https://cdn.example.com/a.ts") !== null, "a public https url is allowed");
    assertEqual(okPublicUrl("http://127.0.0.1/x"), null, "loopback is refused");
    assertEqual(okPublicUrl("http://169.254.169.254/latest/meta-data"), null, "the metadata address is refused");
    assertEqual(okPublicUrl("http://10.0.0.5/x"), null, "a private range is refused");
    assertEqual(okPublicUrl("file:///etc/passwd"), null, "a non-http scheme is refused");
    assertEqual(okPublicUrl("not a url"), null, "junk is refused");
  });

  await test("isPrivateHost classifies the ranges the guard cares about", () => {
    assert(isPrivateHost("localhost"), "localhost");
    assert(isPrivateHost("192.168.1.1"), "a private address");
    assert(isPrivateHost("172.16.0.1"), "the lower private range");
    assert(isPrivateHost("172.31.255.255"), "the upper private range");
    assert(!isPrivateHost("172.32.0.1"), "just outside the private range");
    assert(!isPrivateHost("cdn.example.com"), "a public hostname");
  });
}
