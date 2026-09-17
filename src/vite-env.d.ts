/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_URL?: string;
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
