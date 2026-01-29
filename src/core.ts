import type { z } from "zod";
import {
  CaseTransformer,
  KebabCaseStrategy,
  UnknownCaseStrategy,
} from "@ocelotjungle/case-converters";
import superjson from "superjson";

export type Logger = {
  log: (...args: any[]) => void;
  dir: (...args: any[]) => void;
};

export function log(..._args: any[]) {
  // console.log(...args);
}

export function dir(..._args: any[]) {
  // console.log(...args.map(arg => objectInspect(arg, { depth: Number.MAX_SAFE_INTEGER })));
}

export const kebabTransformer = new CaseTransformer(
  new UnknownCaseStrategy(),
  new KebabCaseStrategy(),
);

export const methods = ["get", "post", "put", "patch", "delete"] as const;

export type Method = (typeof methods)[number];

/**
 * input = schema => input is validated against the schema
 *
 * input = null => input is nothing implicitly
 *
 * input = undefined => validation is disabled, input can be anything
 *
 * output = schema => output is validated against the schema
 *
 * output = null | undefined => validation is disabled, output can be anything
 */
export type SchemaEndpoint = {
  input: z.ZodType | null | undefined;
  output: z.ZodType | null | undefined;
  /** @default true */
  isMetadataUsed?: boolean;
  /** @default true */
  isMetadataRequired?: boolean;
  cacheControl?: string;
  /** @default 0 */
  autoScopeInvalidationDepth?: number;
  invalidate?: string[];
};

export type SchemaRoute = Partial<Record<Method, SchemaEndpoint>>;

export interface Schema extends Record<string, Schema | SchemaRoute> {}

export type Transformer = {
  serialize: (data: any) => string;
  deserialize: (data: string) => any;
};

export const jsonTransformer: Transformer = {
  serialize: JSON.stringify,
  deserialize: JSON.parse,
};

export const superjsonTransformer: Transformer = {
  serialize: superjson.stringify,
  deserialize: superjson.parse,
};
