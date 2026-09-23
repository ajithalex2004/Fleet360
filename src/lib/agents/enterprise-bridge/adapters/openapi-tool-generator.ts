/**
 * OpenAPI 3.0 / Swagger Tool Generator
 * -------------------------------------
 * Ingests external API documentation at runtime and generates callable AI Tool
 * declarations that the Enterprise Bridge Agent can use to execute dynamic REST calls.
 */

interface AiToolParameterProperty {
  type: string;
  description: string;
}

export interface GeneratedAiTool {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  parameters: {
    type: 'object';
    properties: Record<string, AiToolParameterProperty>;
    required?: string[];
  };
}

// -----------------------------------------------------------------------------
// Minimal OpenAPI 3.0 / Swagger shape — only the fields this generator reads.
// The full spec has many more top-level sections (info, components, servers,
// tags, ...) that are irrelevant here, so this intentionally isn't a complete
// OpenAPI type.
// -----------------------------------------------------------------------------

interface OpenApiSchema {
  type?: string;
  description?: string;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
}

interface OpenApiParameter {
  name?: string;
  description?: string;
  required?: boolean;
  schema?: OpenApiSchema;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: {
      'application/json'?: {
        schema?: OpenApiSchema;
      };
    };
  };
}

type OpenApiPathItem = Record<string, OpenApiOperation>;

export interface OpenApiSpec {
  paths?: Record<string, OpenApiPathItem>;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

function isHttpMethod(method: string): method is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(method);
}

/**
 * Parses an OpenAPI 3.0 / Swagger JSON object into executable AI Tool definitions.
 */
export function generateToolsFromOpenApi(openApiSpec: OpenApiSpec): GeneratedAiTool[] {
  const tools: GeneratedAiTool[] = [];
  const paths = openApiSpec.paths || {};

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      const upperMethod = method.toUpperCase();
      if (!isHttpMethod(upperMethod)) continue;

      const operationId = operation.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const summary = operation.summary || operation.description || `Execute ${upperMethod} on ${path}`;

      // Extract parameter schema
      const properties: Record<string, AiToolParameterProperty> = {};
      const required: string[] = [];

      // Query & Path parameters
      if (Array.isArray(operation.parameters)) {
        for (const p of operation.parameters) {
          if (p.name) {
            properties[p.name] = {
              type: p.schema?.type || 'string',
              description: p.description || `Parameter ${p.name}`,
            };
            if (p.required) required.push(p.name);
          }
        }
      }

      // Request Body parameters (JSON)
      const requestBodySchema = operation.requestBody?.content?.['application/json']?.schema;
      if (requestBodySchema?.properties) {
        for (const [propName, propSchema] of Object.entries(requestBodySchema.properties)) {
          properties[propName] = {
            type: propSchema.type || 'string',
            description: propSchema.description || propName,
          };
        }
        if (Array.isArray(requestBodySchema.required)) {
          required.push(...requestBodySchema.required);
        }
      }

      tools.push({
        name: operationId.slice(0, 64),
        description: summary.slice(0, 200),
        method: upperMethod,
        path,
        parameters: {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        },
      });
    }
  }

  return tools;
}
