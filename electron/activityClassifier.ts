import type { ActivityCategory } from "./systemRepository.js";

export function classifyApplication(appName: string): ActivityCategory {
  const value = appName.toLowerCase();
  if (/code|visual studio|cursor|terminal|powershell|cmd|word|excel|powerpoint|obsidian|notion|figma/.test(value)) return "work";
  if (/wechat|微信|feishu|飞书|lark|teams|slack|discord|telegram|outlook/.test(value)) return "communication";
  if (/steam|game|bilibili|哔哩|netflix|spotify|music|音乐|douyin|抖音/.test(value)) return "entertainment";
  if (/kindle|anki|reader|阅读/.test(value)) return "learning";
  // 浏览器不读取标签页标题，因此无法可靠判断工作或娱乐，保守归入“其他”。
  return "other";
}
