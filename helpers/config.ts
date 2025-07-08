// Configuration
export const CONFIG = {
    // Bitte API endpoints
    BITTE_API_BASE: 'https://bitte.ai',
    CHAT_API_URL: 'https://bitte.ai/api/chat',
    MCP_SERVER_URL: 'https://bitte-mcp-sse-446257178793.europe-west1.run.app/sse',
    
    // Default agent configurations
    DEFAULT_AGENT_ID: 'coingecko-ai.vercel.app',
    
    // Network configurations
    NETWORKS: {
      EVM: {
        mainnet: { chainId: 1, rpcUrl: 'https://eth.llamarpc.com' },
        polygon: { chainId: 137, rpcUrl: 'https://polygon.llamarpc.com' },
        arbitrum: { chainId: 42161, rpcUrl: 'https://arbitrum.llamarpc.com' },
        base: { chainId: 8453, rpcUrl: 'https://base.llamarpc.com' },
      },
      NEAR: {
        mainnet: { networkId: 'mainnet', nodeUrl: 'https://rpc.mainnet.near.org' },
        testnet: { networkId: 'testnet', nodeUrl: 'https://rpc.testnet.near.org' },
      },
      SUI: {
        mainnet: { rpcUrl: 'https://fullnode.mainnet.sui.io:443' },
        testnet: { rpcUrl: 'https://fullnode.testnet.sui.io:443' },
      }
    }
  };
  