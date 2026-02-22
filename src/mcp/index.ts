import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { allTools, executeTool } from './tools/index.js';
import { getServerSummary, getServerCache } from './discord-client.js';

/**
 * Create and configure the MCP server for Discord management
 */
export function createMCPServer(): Server {
  const server = new Server(
    {
      name: 'discord-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools,
    };
  });

  // Handle list resources request
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'discord://server/summary',
          name: 'Discord Server Summary',
          description: 'Overview of the Discord server including all channels, roles, and member count. Use this to see available channels before sending messages.',
          mimeType: 'text/plain',
        },
        {
          uri: 'discord://server/channels',
          name: 'Channel List',
          description: 'List of all channels in the Discord server with their exact names',
          mimeType: 'application/json',
        },
        {
          uri: 'discord://server/roles',
          name: 'Role List',
          description: 'List of all roles in the Discord server',
          mimeType: 'application/json',
        },
      ],
    };
  });

  // Handle read resource request
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    switch (uri) {
      case 'discord://server/summary': {
        const summary = await getServerSummary();
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: summary,
            },
          ],
        };
      }
      case 'discord://server/channels': {
        const cache = await getServerCache();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(cache.channels, null, 2),
            },
          ],
        };
      }
      case 'discord://server/roles': {
        const cache = await getServerCache();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(cache.roles, null, 2),
            },
          ],
        };
      }
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });

  // Handle tool execution requests
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await executeTool(name, (args as Record<string, unknown>) ?? {});

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: errorMessage,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start the MCP server with stdio transport
 */
export async function startMCPServer(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr since stdout is used for MCP communication
  console.error('Discord MCP server started');
}
