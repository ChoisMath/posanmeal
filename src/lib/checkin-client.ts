export interface CheckInResult {
  success: boolean;
  duplicate?: boolean;
  notApplicant?: boolean;
  error?: string;
  user?: {
    id: number;
    name: string;
    role: string;
    grade?: number;
    classNum?: number;
    number?: number;
    photoUrl?: string;
  };
  type?: string;
  checkedAt?: string;
  mealKind?: "BREAKFAST" | "DINNER";
}

interface PostCheckInOptions {
  fetchFn?: typeof fetch;
  maxAttempts?: number;
  retryDelayMs?: number;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response: Response): Promise<CheckInResult> {
  try {
    return (await response.json()) as CheckInResult;
  } catch {
    return {
      success: false,
      error: response.ok ? "Invalid server response" : `Server error (${response.status})`,
    };
  }
}

export async function postCheckInWithRetry(
  token: string,
  options: PostCheckInOptions = {},
): Promise<CheckInResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 300;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchFn("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await readJson(response);

      if (response.ok || response.status < 500 || attempt === maxAttempts) {
        return json;
      }
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
    }

    await delay(retryDelayMs);
  }

  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  return { success: false, error: `Server connection error${detail}` };
}
