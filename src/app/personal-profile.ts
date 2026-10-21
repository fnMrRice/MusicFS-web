import { ApiError, errorMessage } from "../api/client";
import type { PersonalProfile, ProfileApi } from "../api/profile";
import { Store } from "./store";

interface ProfileState {
  data: PersonalProfile | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export class PersonalProfileState {
  readonly state = new Store<ProfileState>({ data: null, loading: false, saving: false, error: null });
  private userId: string | null = null;
  private generation = 0;
  private request: AbortController | null = null;
  private pendingRead: Promise<void> | null = null;

  constructor(private api: Pick<ProfileApi, "read" | "save">) {}

  setUser(id: string | null): void {
    ++this.generation;
    this.request?.abort();
    this.request = null;
    this.pendingRead = null;
    this.userId = id;
    this.state.set({ data: null, loading: false, saving: false, error: null });
    if (id !== null) void this.load();
  }

  load(): Promise<void> {
    if (this.userId === null || this.state.value.saving) return Promise.resolve();
    if (this.pendingRead) return this.pendingRead;
    const generation = this.generation;
    const controller = new AbortController();
    this.request = controller;
    this.state.set({ ...this.state.value, loading: true, error: null });
    const promise = this.read(controller, generation).finally(() => {
      if (this.pendingRead === promise) this.pendingRead = null;
    });
    this.pendingRead = promise;
    return promise;
  }

  async save(nickname: string | null): Promise<boolean> {
    if (this.userId === null || this.state.value.saving) return false;
    const generation = this.generation;
    this.request?.abort();
    this.pendingRead = null;
    const controller = new AbortController();
    this.request = controller;
    this.state.set({ ...this.state.value, loading: false, saving: true, error: null });
    try {
      const data = await this.api.save(nickname, controller.signal);
      if (!this.current(controller, generation)) return false;
      this.checkIdentity(data);
      this.state.set({ data, loading: false, saving: false, error: null });
      return true;
    } catch (error) {
      if (this.current(controller, generation))
        this.state.set({ ...this.state.value, saving: false, error: errorMessage(error) });
      return false;
    } finally {
      if (this.current(controller, generation)) this.request = null;
    }
  }

  private async read(controller: AbortController, generation: number): Promise<void> {
    try {
      const data = await this.api.read(controller.signal);
      if (!this.current(controller, generation)) return;
      this.checkIdentity(data);
      this.state.set({ data, loading: false, saving: false, error: null });
    } catch (error) {
      if (this.current(controller, generation))
        this.state.set({ ...this.state.value, loading: false, error: errorMessage(error) });
    } finally {
      if (this.current(controller, generation)) this.request = null;
    }
  }

  private current(controller: AbortController, generation: number): boolean {
    return !controller.signal.aborted && this.request === controller && this.generation === generation;
  }

  private checkIdentity(data: PersonalProfile): void {
    if (data.user.id !== this.userId)
      throw new ApiError("INVALID_RESPONSE", "Personal profile does not match the current account");
  }
}
