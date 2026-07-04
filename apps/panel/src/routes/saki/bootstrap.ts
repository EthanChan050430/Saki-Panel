import { registerSakiExecutorHost } from "./executor.js";
import { initSakiConfigHost } from "./config.js";
import { buildAuditSearchContext } from "./audit.js";
import { browsePublicUrl, crawlPublicSite, researchWeb, simpleWebSearch } from "./web.js";
import { formatSkillForAgent, loadSakiSkills, readSakiSkill } from "./skills.js";

let ready = false;

export function ensureSakiModulesReady(): void {
  if (ready) return;
  initSakiConfigHost();
  registerSakiExecutorHost({
    buildAuditSearchContext,
    simpleWebSearch,
    browsePublicUrl,
    crawlPublicSite,
    researchWeb,
    loadSakiSkills,
    readSakiSkill,
    formatSkillForAgent
  });
  ready = true;
}
