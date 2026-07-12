/**
 * Central module mocks for `@/lib/api` and `@/providers/auth-provider`.
 *
 * vi.mock is HOISTED above imports, so a factory cannot reference a top-level
 * `import { mockApi }`. The working pattern is an async factory that dynamically
 * imports this module (dynamic imports run lazily, after initialization):
 *
 *   import * as apiModule from "@/lib/api";
 *
 *   vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
 *   // or, for file-wide overrides:
 *   // vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi({ chat: vi.fn() }));
 *
 *   const api = vi.mocked(apiModule); // api.fetchCollections.mockResolvedValue(...) per test
 *
 * The factory runs once (module cache), so the vi.fn instances persist; the
 * global `restoreMocks: true` clears call history between tests while keeping
 * the default implementations passed to vi.fn().
 *
 * Auth (signed-in default; pass overrides to change):
 *   vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
 *   import { setMockAuth, resetMockAuth } from "@/test/mocks";
 *   // beforeEach(resetMockAuth); per test: setMockAuth({ token: null, user: null });
 *
 * App config (permissive defaults; pass overrides to change):
 *   vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());
 *   import { setMockAppConfig, resetMockAppConfig } from "@/test/mocks";
 *   // beforeEach(resetMockAppConfig); per test: setMockAppConfig({ config: makePublicConfig({...}) });
 */
import { vi } from "vitest";

import {
  makeAdminUsageSummary,
  makeAdminUsageTimeseries,
  makeAdminUser,
  makeChatCompletion,
  makeChatSession,
  makeChunkDetail,
  makeChunkVisualization,
  makeCollection,
  makeCollectionStats,
  makeStatsHistory,
  makeFileTree,
  makeFileNode,
  makeFileUploadResponse,
  makeBackendInfo,
  makePineconeBackendInfo,
  makeVectorIndex,
  makePipeline,
  makePromptDetails,
  makeProviderDirectory,
  makePublicConfig,
  makeQueryResult,
  makeTraceResponse,
  makeUmapVisualization,
  makeUser,
  makeValidation,
} from "@/test/fixtures";

import type { PublicConfig, User } from "@/lib/types";

const MOCK_AUTH_TOKEN = "test-token";

type AuthValue = {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  signIn: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  refreshProfile: ReturnType<typeof vi.fn>;
};

/**
 * Full `@/lib/api` module mock. Every exported function is a vi.fn() with a
 * sensible default; `overrides` replaces specific ones for a whole file.
 */
export function mockApi(overrides: Record<string, unknown> = {}) {
  return {
    API_BASE_URL: "http://api.test",
    // admin
    fetchAdminUsers: vi.fn(async () => []),
    fetchAdminUsageSummary: vi.fn(async () => makeAdminUsageSummary()),
    fetchAdminUsageTimeseries: vi.fn(async () => makeAdminUsageTimeseries()),
    updateAdminUser: vi.fn(async () => makeAdminUser()),
    // auth
    loginRequest: vi.fn(async () => ({ access_token: MOCK_AUTH_TOKEN, token_type: "bearer" })),
    refreshSession: vi.fn(async () => ({ access_token: MOCK_AUTH_TOKEN, token_type: "bearer" })),
    logoutRequest: vi.fn(async () => undefined),
    listAuthSessions: vi.fn(() => new Promise(() => {})),
    revokeAuthSession: vi.fn(async () => undefined),
    revokeAllAuthSessions: vi.fn(async () => undefined),
    registerUser: vi.fn(async () => makeUser()),
    getProfile: vi.fn(async () => makeUser()),
    updateUserSettings: vi.fn(async () => makeUser()),
    updateRunSettingsOrder: vi.fn(async () => makeUser()),
    validateProviderKey: vi.fn(async () => ({
      configured: true,
      valid: true,
      message: null,
    })),
    validateUserKeys: vi.fn(async () => ({
      openrouter: { configured: true, valid: true },
      pinecone: { configured: true, valid: true },
    })),
    // collections
    fetchCollections: vi.fn(async () => []),
    fetchCollection: vi.fn(async () => makeCollection()),
    fetchCollectionStats: vi.fn(async () => []),
    fetchCollectionStatsById: vi.fn(async () => makeCollectionStats()),
    fetchCollectionStatsHistory: vi.fn(async () => makeStatsHistory()),
    getCollectionPrompt: vi.fn(async () => makePromptDetails()),
    getBasePrompt: vi.fn(async () => makePromptDetails()),
    updateCollectionPrompt: vi.fn(async () => makePromptDetails()),
    updateBasePrompt: vi.fn(async () => makePromptDetails()),
    createCollection: vi.fn(async () => makeCollection()),
    updateCollection: vi.fn(async () => makeCollection()),
    deleteCollection: vi.fn(async () => undefined),
    fetchDocuments: vi.fn(async () => []),
    // files
    fetchFileTree: vi.fn(async () => makeFileTree()),
    fetchFolderListing: vi.fn(async () => ({ parent: null, breadcrumb: [], entries: [] })),
    createFolder: vi.fn(async () => makeFileNode({ kind: "folder" })),
    uploadFile: vi.fn(async () => makeFileUploadResponse()),
    updateFileNode: vi.fn(async () => makeFileNode()),
    copyFileNode: vi.fn(async () => makeFileNode()),
    deleteFileNode: vi.fn(async () => undefined),
    ingestFile: vi.fn(async () => makeFileNode()),
    searchFiles: vi.fn(async () => ({ query: "", folders: [], files: [], content: [] })),
    fetchFileBlob: vi.fn(async () => new Blob(["content"], { type: "text/plain" })),
    fetchDocumentChunks: vi.fn(async () => makeChunkVisualization()),
    fetchChunkDetail: vi.fn(async () => makeChunkDetail()),
    fetchCollectionUmap: vi.fn(async () => null),
    computeCollectionUmap: vi.fn(async () => makeUmapVisualization()),
    runCollectionQuery: vi.fn(async () => makeQueryResult()),
    fetchPipelineRunTrace: vi.fn(async () => makeTraceResponse()),
    fetchDocumentTrace: vi.fn(async () => makeTraceResponse()),
    fetchQueryEventTrace: vi.fn(async () => makeTraceResponse()),
    fetchQueryEventEndToEndTrace: vi.fn(async () => ({
      retrieval: makeTraceResponse(),
      origin: null,
    })),
    // pipelines
    fetchPipelines: vi.fn(async () => []),
    fetchPipeline: vi.fn(async () => makePipeline()),
    fetchPipelineNodes: vi.fn(async () => []),
    listIndexes: vi.fn(async () => []),
    fetchIndexBackends: vi.fn(async () => [makeBackendInfo(), makePineconeBackendInfo()]),
    describeIndex: vi.fn(async () => makeVectorIndex()),
    createIndex: vi.fn(async () => makeVectorIndex()),
    deleteIndex: vi.fn(async () => undefined),
    validatePipeline: vi.fn(async () => makeValidation()),
    createPipeline: vi.fn(async () => makePipeline()),
    updatePipeline: vi.fn(async () => makePipeline()),
    deletePipeline: vi.fn(async () => undefined),
    listPipelineVersions: vi.fn(async () => []),
    activatePipelineVersion: vi.fn(async () => makePipeline()),
    // chat
    listChatSessions: vi.fn(async () => []),
    getChatHistory: vi.fn(async () => []),
    deleteChatSession: vi.fn(async () => undefined),
    branchChatSession: vi.fn(async () => ({ session: makeChatSession(), messages: [] })),
    chat: vi.fn(async () => makeChatCompletion()),
    streamChat: vi.fn(async () => makeChatCompletion()),
    // models
    fetchEmbeddingModels: vi.fn(async () => []),
    listModels: vi.fn(async () => []),
    listModelEndpoints: vi.fn(async () => ({ data: makeProviderDirectory() })),
    // config
    fetchPublicConfig: vi.fn(async () => makePublicConfig()),
    fetchAdminConfig: vi.fn(async () => []),
    updateAdminConfig: vi.fn(async () => []),
    // setup
    fetchSetupStatus: vi.fn(async () => ({
      openrouter_configured: true,
      has_index: true,
      has_collection: true,
      setup_complete: true,
    })),
    bootstrapSetup: vi.fn(async () => ({ collection: makeCollection() })),
    ...overrides,
  };
}

function buildAuthValue(overrides: Partial<AuthValue> = {}): AuthValue {
  return {
    user: makeUser(),
    token: MOCK_AUTH_TOKEN,
    loading: false,
    error: null,
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    refreshProfile: vi.fn(async () => {}),
    ...overrides,
  };
}

let authValue: AuthValue = buildAuthValue();
let authDefaults: Partial<AuthValue> = {};

/** Replace the current mocked auth value (merged onto the file default). */
export function setMockAuth(overrides: Partial<AuthValue> = {}) {
  authValue = buildAuthValue({ ...authDefaults, ...overrides });
  return authValue;
}

/** Reset auth to the file default captured by the last `mockAuth(...)` call. */
export function resetMockAuth() {
  authValue = buildAuthValue(authDefaults);
}

/**
 * `@/providers/auth-provider` module mock. `overrides` become the file default
 * (restored by `resetMockAuth`); `setMockAuth` adjusts per test.
 */
export function mockAuth(overrides: Partial<AuthValue> = {}) {
  authDefaults = overrides;
  authValue = buildAuthValue(overrides);
  return {
    useAuth: () => authValue,
  };
}

type AppConfigValue = {
  config: PublicConfig;
  loading: boolean;
};

function buildAppConfigValue(overrides: Partial<AppConfigValue> = {}): AppConfigValue {
  return {
    config: makePublicConfig(),
    loading: false,
    ...overrides,
  };
}

let appConfigValue: AppConfigValue = buildAppConfigValue();
let appConfigDefaults: Partial<AppConfigValue> = {};

/** Replace the current mocked config value (merged onto the file default). */
export function setMockAppConfig(overrides: Partial<AppConfigValue> = {}) {
  appConfigValue = buildAppConfigValue({ ...appConfigDefaults, ...overrides });
  return appConfigValue;
}

/** Reset config to the file default captured by the last `mockAppConfig(...)` call. */
export function resetMockAppConfig() {
  appConfigValue = buildAppConfigValue(appConfigDefaults);
}

/**
 * `@/providers/config-provider` module mock. `overrides` become the file
 * default (restored by `resetMockAppConfig`); `setMockAppConfig` adjusts per
 * test.
 */
export function mockAppConfig(overrides: Partial<AppConfigValue> = {}) {
  appConfigDefaults = overrides;
  appConfigValue = buildAppConfigValue(overrides);
  return {
    useAppConfig: () => appConfigValue,
  };
}

/**
 * `@/providers/theme-provider` module mock — a pass-through provider and a
 * fixed dark `useTheme`. Lets components that render a ThemeToggle mount in
 * tests without the real provider (and without touching matchMedia/storage):
 *   vi.mock("@/providers/theme-provider", async () =>
 *     (await import("@/test/mocks")).mockTheme());
 */
export function mockTheme() {
  return {
    ThemeProvider: ({ children }: { children: unknown }) => children,
    useTheme: () => ({
      theme: "dark" as const,
      resolvedTheme: "dark" as const,
      setTheme: vi.fn(),
      toggleTheme: vi.fn(),
    }),
  };
}
