/**
 * E2E Worker service — legacy stub.
 *
 * Real E2E runs on the main thread via services/e2e (Double Ratchet).
 * This file is kept only so App.tsx compiles without changes.
 * All crypto methods were removed (broken legacy worker deleted).
 */

class E2EWorkerService {
  private initialized = false

  async init(): Promise<boolean> {
    this.initialized = true
    return false
  }

  terminate(): void {
    this.initialized = false
  }

  isUsingWorker(): boolean {
    return false
  }
}

export const e2eWorkerService = new E2EWorkerService()
export default e2eWorkerService
