declare module "@homebridge/node-pty-prebuilt-multiarch" {
  export interface IDisposable {
    dispose(): void;
  }

  export type IEvent<T> = (listener: (event: T) => void) => IDisposable;

  export interface IPty {
    readonly pid: number;
    readonly onData: IEvent<string>;
    readonly onExit: IEvent<{ exitCode: number; signal?: number }>;
    write(data: string): void;
    kill(signal?: string): void;
    resize?(cols: number, rows: number): void;
  }

  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
    encoding?: string | null;
    useConpty?: boolean;
    useConptyDll?: boolean;
  }

  export function spawn(file: string, args?: string[] | string, options?: IPtyForkOptions): IPty;
}
