export function sakiChatErrorMessage(message: string, status: number): string {
  // Older production panels replace deliberate conflict reasons with this
  // generic message. Keep useful server messages when they are available.
  if (status === 409 && /^(bad request|conflict|request failed with 409)$/i.test(message.trim())) {
    return "任务状态冲突（409）：请检查历史会话中是否有正在执行或等待回答的任务，先回到原对话处理或停止该任务。若已更换工作区，请重新描述任务。";
  }
  return message;
}
