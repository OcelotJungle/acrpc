import type { Request, Response } from "express";
import type {
  Method,
  Schema,
  SchemaEndpoint,
  SchemaRoute,
  Transformer,
} from "./core";
import type { DeepPartial } from "./types";
import express, { Router } from "express";
import { z } from "zod";
import { dir, jsonTransformer, kebabTransformer, log } from "./core";

type MaybePromise<T> = T | Promise<T>;

export type SchemaRouteHandlers<
  TSchemaEndpoint extends SchemaRoute,
  TMetadata = never,
> = {
  [M in keyof TSchemaEndpoint]: TSchemaEndpoint[M] extends SchemaEndpoint
    ? (
        input: TSchemaEndpoint[M]["input"] extends z.ZodType
          ? z.infer<TSchemaEndpoint[M]["input"]>
          : TSchemaEndpoint[M]["input"] extends null
            ? never
            : unknown,

        metadata:
          | (TSchemaEndpoint[M]["isMetadataUsed"] extends false
              ? never
              : TMetadata)
          | (TSchemaEndpoint[M]["isMetadataRequired"] extends false
              ? null
              : never),

        rest: {
          req: Request;
          res: Response;
        },
      ) => MaybePromise<
        TSchemaEndpoint[M]["output"] extends z.ZodType
          ? z.infer<TSchemaEndpoint[M]["output"]>
          : unknown
      >
    : TSchemaEndpoint[M] extends SchemaRoute
      ? SchemaRouteHandlers<TSchemaEndpoint[M], TMetadata>
      : TSchemaEndpoint[M] extends Schema
        ? SchemaRouteHandlers<TSchemaEndpoint[M], TMetadata>
        : never;
};

export type Handlers<TSchema extends Schema, TMetadata = never> = {
  [K in keyof TSchema]: TSchema[K] extends SchemaRoute
    ? SchemaRouteHandlers<TSchema[K], TMetadata>
    : TSchema[K] extends Schema
      ? Handlers<TSchema[K], TMetadata>
      : never;
};

export type PartialHandlers<
  TSchema extends Schema,
  TMetadata = never,
> = DeepPartial<Handlers<TSchema, TMetadata>>;

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

type InputParseResult =
  | { success: true; data: unknown }
  | { success: false; status: number; response: unknown };

function getInput(
  req: Request,
  inputSchema: z.ZodType | null | undefined,
  transformer: Transformer,
): InputParseResult {
  let body: unknown = null;

  dir({
    method: req.method,
    query: req.query,
    body: req.body,
  });

  if (req.method === "GET") {
    body = req.query.__body
      ? decodeURIComponent(req.query.__body as string)
      : null;

    log("get", { body });

    if (inputSchema && !body) {
      return {
        success: false,
        status: 400,
        response: {
          error: "No __body provided",
        },
      };
    }
  } else {
    body = req.body;

    log("non-get", { body });

    if (inputSchema && !body) {
      return {
        success: false,
        status: 400,
        response: {
          error: "No body provided",
        },
      };
    }
  }

  log("before deserialize", { body });

  const rawInput = body ? transformer.deserialize(body as string) : null;

  dir({ rawInput });

  if (inputSchema) {
    const schemaParseResult = inputSchema.safeParse(rawInput);

    dir({ schemaParseResult });

    if (schemaParseResult.success) {
      return {
        success: true,
        data: schemaParseResult.data,
      };
    }

    return {
      success: false,
      status: 400,
      response: schemaParseResult.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    };
  }

  return {
    success: true,
    data: rawInput,
  };
}

export function createServer<
  TSchema extends Schema,
  TMetadata extends Record<string, any> = never,
>(
  schema: TSchema,
  handlers: PartialHandlers<TSchema, TMetadata>,
  options?: {
    transformer?: Transformer;
    getMetadata?: (req: Request, isRequired: boolean) => TMetadata | null;
  },
) {
  const transformer = options?.transformer ?? jsonTransformer;
  const getMetadata = options?.getMetadata;
  const router = Router();

  const textMiddleware = express.text({ type: "*/*" });

  function fillRouter(
    schema: Record<string, any>,
    handlers: Record<string, any>,
    names: readonly string[],
  ) {
    log({ names });

    for (const [name, handler] of Object.entries(handlers) as [string, any][]) {
      log({ name });

      const schemaEntry = schema[name];

      if (isEndpoint(schemaEntry)) {
        const path = ["", ...names].join("/");
        const method = name as Method;
        const okStatus = method === "post" ? 201 : 200;

        log(`Registering ${method.toUpperCase()} ${path}...`);

        if (method !== "get") {
          router[method](path, textMiddleware);
        }

        router[method](path, async (req, res) => {
          let metadata: TMetadata | null | undefined;

          const isMetadataUsed = schemaEntry.isMetadataUsed ?? true;
          const isMetadataRequired = schemaEntry.isMetadataRequired ?? true;

          dir({
            getMetadata,
            isMetadataUsed,
            isMetadataRequired,
          });

          if (isMetadataUsed) {
            metadata = getMetadata?.(req, isMetadataRequired) ?? null;

            dir({ metadata });

            if (isMetadataRequired && !metadata) {
              return res.status(400).json({
                error: "Metadata cannot be parsed.",
              });
            }
          }

          const inputParseResult = getInput(
            req,
            schemaEntry.input,
            transformer,
          );

          dir({ inputParseResult });

          if (!inputParseResult.success) {
            return res
              .status(inputParseResult.status)
              .json(inputParseResult.response);
          }

          dir({ handlers });

          const rawOutput = await handler(
            inputParseResult.data,
            metadata ?? null,
            {
              req,
              res,
            },
          );

          let output: unknown = null;

          if (schemaEntry.output !== null) {
            let parsedOutput: unknown = null;

            if (schemaEntry.output) {
              const outputParseResult = schemaEntry.output.safeParse(rawOutput);

              dir({
                rawOutput,
                outputParseResult,
              });

              if (outputParseResult.error) {
                return res.status(500).json(outputParseResult.error);
              }

              parsedOutput = outputParseResult.data;
            } else {
              parsedOutput = rawOutput;
            }

            const serializedOutput = transformer.serialize(parsedOutput);

            dir({ serializedOutput });

            output = serializedOutput;
          }

          if (schemaEntry.cacheControl && !res.headersSent) {
            res.setHeader("Cache-Control", schemaEntry.cacheControl);
          }

          if (!res.headersSent) {
            res.status(okStatus);
          }

          if (!res.writableEnded) {
            if (output != null) {
              res.send(output);
            } else {
              res.send("");
            }
          }

          return;
        });
      } else {
        fillRouter(schema[name] as Schema, handlers[name], [
          ...names,
          kebabTransformer.transform(name),
        ]);
      }
    }
  }

  fillRouter(schema, handlers, []);

  function register(handlers: PartialHandlers<TSchema, TMetadata>) {
    fillRouter(schema, handlers, []);
  }

  return {
    router,
    register,
  };
}
