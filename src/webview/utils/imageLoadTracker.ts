interface ImageLoadState {
  loadId: string;
  expected: Set<string>;
  completed: Set<string>;
  failed: Set<string>;
  resolve: () => void;
  promise: Promise<void>;
}

let currentState: ImageLoadState | undefined;

export function beginImageLoadTracking(loadId: string, componentIds: string[]): void {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  currentState = {
    loadId,
    expected: new Set(componentIds),
    completed: new Set(),
    failed: new Set(),
    resolve,
    promise,
  };
  if (componentIds.length === 0) {
    resolve();
  }
}

function finishImage(componentId: string, failed: boolean): void {
  const state = currentState;
  if (!state || !state.expected.has(componentId)) {
    return;
  }
  state.completed.add(componentId);
  if (failed) {
    state.failed.add(componentId);
  }
  if (state.completed.size >= state.expected.size) {
    state.resolve();
  }
}

export function markImageReady(componentId: string): void {
  finishImage(componentId, false);
}

export function markImageFailed(componentId: string): void {
  finishImage(componentId, true);
}

export async function waitForTrackedImages(loadId: string, timeoutMs = 5000): Promise<{
  expected: number;
  completed: number;
  failed: number;
  timedOut: boolean;
}> {
  const state = currentState;
  if (!state || state.loadId !== loadId) {
    return { expected: 0, completed: 0, failed: 0, timedOut: false };
  }

  let timedOut = false;
  await Promise.race([
    state.promise,
    new Promise<void>(resolve => setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs)),
  ]);

  return {
    expected: state.expected.size,
    completed: state.completed.size,
    failed: state.failed.size,
    timedOut,
  };
}
