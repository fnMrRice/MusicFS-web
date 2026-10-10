export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(public value: T) {}
  getSnapshot = (): T => this.value;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(value: T): void {
    this.value = value;
    this.listeners.forEach((listener) => listener());
  }
}
