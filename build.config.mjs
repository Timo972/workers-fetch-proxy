import { defineBuildConfig } from "obuild/config";

// One bundle entry per public export. obuild names outputs after their path
// under src/ (e.g. src/socks5/index.ts -> dist/socks5/index.mjs) and hoists
// code shared between them into dist/_chunks, so nothing is duplicated.
export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: [
        "./src/index.ts",
        "./src/socks5/index.ts",
        "./src/http/index.ts",
        "./src/https/index.ts",
      ],
    },
  ],
});
