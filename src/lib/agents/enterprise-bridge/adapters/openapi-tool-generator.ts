/**
 * OpenAPI 3.0 / Swagger Tool Generator
 * -------------------------------------
 * Ingests external API documentation at runtime and generates callable AI Tool
 * declarations that the Enterprise Bridge Agent can use to execute dynamic REST calls.
 */

export interface GeneratedAiTool {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Parses an OpenAPI 3.0 / Swagger JSON object into executable AI Tool definitions.
 */
export function generateToolsFromOpenApi(openApiSpec: Record<string, any>): GeneratedAiTool[] {
  const tools: GeneratedAiTool[] = [];
  const paths = openApiSpec.paths || {};

  for (const [path, pathItem] of Object.entries<any>(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [method, operation] of Object.entries<any>(pathItem)) {
      const upperMethod = method.toUpperCase();
      if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(upperMethod)) continue;

      const operationId = operation.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const summary = operation.summary || operation.description || `Execute ${upperMethod} on ${path}`;

      // Extract parameter schema
      const properties: Record<string, any> = {};
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
        for (const [propName, propSchema] of Object.entries<any>(requestBodySchema.properties)) {
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
        method: upperMethod as any,
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
