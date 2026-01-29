import type {
  Method,
  Schema,
  SchemaEndpoint,
  SchemaRoute,
  Transformer,
} from "./core";
import { z } from "zod";
import { dir, jsonTransformer, kebabTransformer, log } from "./core";

type MaybePromise<T> = T | Promise<T>;

function isEndpoint(schemaEntry: unknown): schemaEntry is SchemaEndpoint {
  return (
    schemaEntry != null &&
    typeof schemaEntry === "object" &&
    "input" in schemaEntry &&
    (schemaEntry.input instanceof z.ZodType ||
      schemaEntry.input === null ||
      schemaEntry.input === undefined) &&
    "output" in schemaEntry &&
    (schemaEntry.output instanceof z.ZodType ||
      schemaEntry.output === null ||
      schemaEntry.output === undefined)
  );
}

type ClientFetcherInit<TInterceptorContext = unknown> = RequestInit & {
  fetch?: typeof fetch;
  skipInterceptor?: boolean;
  ctx?: TInterceptorContext;
};

export type ClientRouteFetcher<
  TSchemaRoute extends SchemaRoute,
  TInterceptorContext,
> = {
  [M in keyof TSchemaRoute]: TSchemaRoute[M] extends SchemaEndpoint
    ? TSchemaRoute[M]["input"] extends null
      ? (
          init?: ClientFetcherInit<TInterceptorContext>,
        ) => Promise<
          TSchemaRoute[M]["output"] extends z.ZodType
            ? z.infer<TSchemaRoute[M]["output"]>
            : unknown
        >
      : TSchemaRoute[M]["input"] extends z.ZodType
        ? (
            input: z.input<TSchemaRoute[M]["input"]>,
            init?: ClientFetcherInit<TInterceptorContext>,
          ) => Promise<
            TSchemaRoute[M]["output"] extends z.ZodType
              ? z.infer<TSchemaRoute[M]["output"]>
              : unknown
          >
        : (
            input?: unknown,
            init?: ClientFetcherInit<TInterceptorContext>,
          ) => Promise<
            TSchemaRoute[M]["output"] extends z.ZodType
              ? z.infer<TSchemaRoute[M]["output"]>
              : unknown
          >
    : TSchemaRoute[M] extends SchemaRoute
      ? ClientRouteFetcher<TSchemaRoute[M], TInterceptorContext>
      : TSchemaRoute[M] extends Schema
        ? ClientFetcher<TSchemaRoute[M], TInterceptorContext>
        : never;
};

export type ClientFetcher<TSchema extends Schema, TInterceptorContext> = {
  [K in keyof TSchema]: TSchema[K] extends SchemaRoute
    ? ClientRouteFetcher<TSchema[K], TInterceptorContext>
    : TSchema[K] extends Schema
      ? ClientFetcher<TSchema[K], TInterceptorContext>
      : never;
};

export type Client<
  TSchema extends Schema,
  TInterceptorContext = unknown,
> = ReturnType<typeof createClient<TSchema, TInterceptorContext>>;

export class HttpError extends Error {
  method: string;
  url: string;
  status: number;
  description: string;

  constructor(
    method: string,
    url: string,
    status: number,
    description: string,
  ) {
    super(
      `Fetch at ${method.toUpperCase()} ${url} failed, status ${status}, description: '${description}'`,
    );

    this.method = method;
    this.url = url;
    this.status = status;
    this.description = description;
  }
}

export function createClient<
  TSchema extends Schema,
  TInterceptorContext = unknown,
>(
  schema: TSchema,
  options: {
    entrypointUrl: string;
    transformer?: Transformer;
    init?: RequestInit;
    fetch?: typeof fetch;
    interceptor?: (data: {
      method: Method;
      path: string;
      response: Response;
      ctx?: TInterceptorContext | undefined;
    }) => MaybePromise<void>;
  },
) {
  const transformer = options.transformer ?? jsonTransformer;

  const entrypointUrl = options.entrypointUrl.endsWith("/")
    ? options.entrypointUrl.slice(0, -1)
    : options.entrypointUrl;

  const baseFetch = options.fetch ?? fetch;
  const baseInit: RequestInit = { ...options.init };

  function fillClientFetcher(
    schema: Schema,
    names: readonly string[],
    result: any,
  ) {
    // dir({ url, names });

    for (const [name, schemaEntry] of Object.entries(schema) as [
      string,
      any,
    ][]) {
      const kebabName = kebabTransformer.transform(name);

      if (isEndpoint(schemaEntry)) {
        const path = ["", ...names].join("/");
        const method = name as Method;

        function parseArgs(
          args: any[],
        ): [unknown, ClientFetcherInit<TInterceptorContext> | undefined] {
          if (schemaEntry.input === null) {
            return [undefined, { ...args[0] }];
          }

          return [args[0], args[1]];
        }

        const obj = {
          [method]: async (...args: any[]) => {
            const [input, init] = parseArgs(args);

            if (schemaEntry.input != null && !input) {
              throw new Error("Input data argument not provided.");
            }

            log(`Performing ${method.toUpperCase()} ${path}...`);
            // dir({ input, init });

            dir({
              entrypointUrl,
              path,
            });

            const requestInit = {
              ...baseInit,
              ...init,

              headers: {
                ...baseInit.headers,
                ...init?.headers,
              } as Record<string, string>,

              method: method.toUpperCase(),
            };

            let searchQuery = "";

            if (schemaEntry.input !== null && input !== undefined) {
              const serializedInput = transformer.serialize(input);
              // dir({ serializedInput });

              if (method === "get") {
                searchQuery = `__body=${encodeURIComponent(serializedInput)}`;
              } else {
                requestInit.headers["Content-Type"] = "application/json";
                requestInit.body = serializedInput;
              }
            }

            const fetch = init?.fetch ?? baseFetch;
            delete init?.fetch;

            const search = searchQuery ? `?${searchQuery}` : "";

            dir({
              fetchUrl: entrypointUrl + path + search,
            });

            const fetchResult = await fetch(
              entrypointUrl + path + search,
              requestInit,
            );

            if (!init?.skipInterceptor) {
              await options.interceptor?.({
                method,
                path,
                response: fetchResult,
                ctx: init?.ctx,
              });
            }

            if (fetchResult.ok) {
              let output: unknown = null;

              if (schemaEntry.output !== null) {
                const rawOutput = await fetchResult.text();
                output = transformer.deserialize(rawOutput);
              }

              return output;
            }

            throw new HttpError(
              method,
              path,
              fetchResult.status,
              (await fetchResult.text()) || fetchResult.statusText,
            );
          },
        };

        Object.assign(result, obj);
      } else {
        const nestedResult = {};
        result[name] = nestedResult;

        fillClientFetcher(schemaEntry, [...names, kebabName], nestedResult);
      }
    }

    return result;
  }

  const fetcher: ClientFetcher<TSchema, TInterceptorContext> =
    fillClientFetcher(schema, [], {});

  return {
    fetcher,
  };
}
