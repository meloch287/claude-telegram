import {cpSync, mkdirSync} from "node:fs";
const target = new URL("../dist/miniapp/public/", import.meta.url);
mkdirSync(target, {recursive: true});
cpSync(new URL("../src/miniapp/public/", import.meta.url), target, {recursive: true});
