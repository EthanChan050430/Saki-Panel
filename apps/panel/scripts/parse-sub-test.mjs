import { readFileSync } from "node:fs";
import { fetchClashSubscriptionProxies } from "../src/clash-subscription.ts";

const yaml = readFileSync(
  "C:/Users/EthanChan/AppData/Roaming/com.follow/clash/profiles/1787922984356.yaml",
  "utf8"
);

const url = "https://art.oteupright.cc/musub?set=0f34a91210aa1f062dab4540cc1dfc5e";
const parsedFromFile = (await import("node:module")).createRequire(import.meta.url);

function parseWithExportedLogic() {
  const start = yaml.search(/^proxies:\s*$/m);
  console.log("proxies line", start);
}

parseWithExportedLogic();

try {
  const proxies = await fetchClashSubscriptionProxies(url);
  console.log("fetched", proxies.length, proxies.slice(0, 3));
} catch (error) {
  console.log("fetch error", error instanceof Error ? error.message : error);
}
