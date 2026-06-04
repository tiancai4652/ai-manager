declare module 'node-notifier' {
  interface NotificationCenter {
    notify(options: {
      title?: string;
      message: string;
      appID?: string;
      sound?: boolean;
      icon?: string;
      wait?: boolean;
    }, callback?: (err: Error | null, response: string, metadata?: any) => void): void;
    on(event: 'click', callback: (obj: { title?: string; message?: string }) => void): void;
    on(event: 'timeout', callback: () => void): void;
  }
  const notifier: NotificationCenter;
  export default notifier;
}
