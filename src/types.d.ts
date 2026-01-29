export type Normalize<T> = { [Key in keyof T]: T[Key] } & {};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown>
    ? DeepPartial<T[K]>
    : T[K];
};
