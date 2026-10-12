export class ConversationSyncQueue<T extends { id: string }> {
  private versions = new Map<string, string>();
  private generations = new Map<string, number>();
  private tails = new Map<string, Promise<void>>();
  constructor(private write: (value: T, baseUpdatedAt?: string) => Promise<{ updatedAt: string }>, private conflict: (id: string, error: unknown) => void) {}
  version(id: string): string | undefined { return this.versions.get(id); }
  observe(id: string, updatedAt: string): void {
    const previous = this.versions.get(id);
    if (previous && updatedAt <= previous) return;
    this.versions.set(id, updatedAt);
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
  }
  save(value: T): Promise<void> {
    const generation = this.generations.get(value.id) ?? 0;
    const operation = (this.tails.get(value.id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (generation !== (this.generations.get(value.id) ?? 0)) return;
      try {
        const result = await this.write(value, this.versions.get(value.id));
        const previous = this.versions.get(value.id);
        if (!previous || result.updatedAt > previous) this.versions.set(value.id, result.updatedAt);
      } catch (error) {
        this.generations.set(value.id, (this.generations.get(value.id) ?? 0) + 1);
        this.conflict(value.id, error);
        throw error;
      }
    });
    this.tails.set(value.id, operation);
    void operation.finally(() => { if (this.tails.get(value.id) === operation) this.tails.delete(value.id); }).catch(() => {});
    return operation;
  }
}
