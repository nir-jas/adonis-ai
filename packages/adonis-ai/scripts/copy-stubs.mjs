import { cp, mkdir } from "node:fs/promises";

await mkdir(new URL("../build/stubs/", import.meta.url), { recursive: true });
await cp(
  new URL("../stubs/config/", import.meta.url),
  new URL("../build/stubs/config/", import.meta.url),
  {
    recursive: true,
  },
);
await cp(
  new URL("../stubs/make/", import.meta.url),
  new URL("../build/stubs/make/", import.meta.url),
  {
    recursive: true,
  },
);
