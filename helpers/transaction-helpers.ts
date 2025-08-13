import type { SwapFTData, TransferFTData } from "@bitte-ai/types";
import type { SignRequestData } from "near-safe";
import { toHex } from "viem";

// Define the WalletSendCallsParams type
type WalletSendCallsParams = {
	version: string;
	chainId: `0x${string}`;
	from: `0x${string}`;
	calls: {
		to?: `0x${string}`;
		data?: `0x${string}`;
		value?: `0x${string}`;
		gas?: `0x${string}`;
		metadata?: {
			description: string;
			transactionType: string;
		} & Record<string, string>;
	}[];
	capabilities?: Record<string, string>;
};

// Define the generate-evm-tx tool response type
interface GenerateEvmTxResponse {
	evmSignRequest: SignRequestData;
	ui?: SwapFTData | TransferFTData | Record<string, unknown>;
}

// Helper function to convert chainId to hex
function chainIdToHex(chainId: number): `0x${string}` {
	return toHex(chainId) as `0x${string}`;
}

// Helper function to generate metadata based on UI data
function generateMetadata(
	method: string,
	ui?: SwapFTData | TransferFTData | Record<string, unknown>,
): { description: string; transactionType: string } & Record<string, string> {
	const baseMetadata = {
		description: "",
		transactionType: method,
	};

	if (!ui || typeof ui !== "object") {
		return {
			...baseMetadata,
			description: `Execute ${method} transaction`,
		};
	}

	// Type guard for checking if ui has a type property
	if (!("type" in ui)) {
		return {
			...baseMetadata,
			description: `Execute ${method} transaction`,
		};
	}

	// Handle swap type
	if (ui.type === "swap") {
		const swapData = ui as Partial<SwapFTData>;
		const tokenInAmount = swapData.tokenIn?.amount || "unknown amount";
		const tokenOutAmount = swapData.tokenOut?.amount || "unknown amount";
		const networkName = swapData.network?.name || "unknown network";

		return {
			...baseMetadata,
			description: `Swap ${tokenInAmount} for ${tokenOutAmount}`,
			transactionType: "swap",
			network: networkName,
			...(swapData.tokenIn?.contractAddress && {
				tokenInAddress: swapData.tokenIn.contractAddress,
			}),
			...(swapData.tokenOut?.contractAddress && {
				tokenOutAddress: swapData.tokenOut.contractAddress,
			}),
			...(swapData.tokenIn?.amount && {
				tokenInAmount: swapData.tokenIn.amount,
			}),
			...(swapData.tokenOut?.amount && {
				tokenOutAmount: swapData.tokenOut.amount,
			}),
		};
	}

	// Handle transfer type
	if (ui.type === "transfer-ft") {
		const transferData = ui as Partial<TransferFTData>;
		const tokenAmount = transferData.token?.amount || "unknown amount";
		const tokenSymbol = transferData.token?.symbol || "";
		const receiver = transferData.receiver || "unknown";
		const networkName = transferData.network?.name || "unknown network";

		return {
			...baseMetadata,
			description: `Transfer ${tokenAmount} ${tokenSymbol} to ${receiver}`,
			transactionType: "transfer",
			network: networkName,
			...(transferData.token?.contractAddress && {
				tokenAddress: transferData.token.contractAddress,
			}),
			...(transferData.token?.amount && {
				tokenAmount: transferData.token.amount,
			}),
			...(transferData.token?.symbol && {
				tokenSymbol: transferData.token.symbol,
			}),
			...(transferData.sender && { sender: transferData.sender }),
			...(transferData.receiver && { receiver: transferData.receiver }),
		};
	}

	// Fallback for unknown UI types
	return {
		...baseMetadata,
		description: `Execute ${method} transaction`,
	};
}

// Main conversion function
export async function convertEvmTxToWalletSendCalls(
	response: GenerateEvmTxResponse,
	userAddress: `0x${string}`,
): Promise<WalletSendCallsParams> {
	const { evmSignRequest, ui } = response;
	const { method, chainId, params } = evmSignRequest;

	// Cast ui to a more flexible type for metadata generation
	const uiForMetadata = ui as
		| SwapFTData
		| TransferFTData
		| Record<string, unknown>
		| undefined;

	switch (method) {
		case "eth_sendTransaction": {
			// Handle transaction sending
			const transactions = params as Array<{
				to: `0x${string}`;
				data: `0x${string}`;
				value: `0x${string}`;
				from: `0x${string}`;
			}>;

			return {
				version: "1.0",
				chainId: chainIdToHex(chainId),
				from: userAddress,
				calls: transactions.map((tx, index) => ({
					to: tx.to,
					data: tx.data,
					value: tx.value,
					metadata: {
						...generateMetadata(method, uiForMetadata),
						callIndex: String(index),
					},
				})),
			};
		}

		case "personal_sign": {
			// Handle personal_sign - params: [message, address]
			const [message, signerAddress] = params as [`0x${string}`, `0x${string}`];

			// Create a contract call that represents the signing operation
			// This is a pseudo-transaction that represents a signing request
			return {
				version: "1.0",
				chainId: chainIdToHex(chainId),
				from: signerAddress,
				calls: [
					{
						// No 'to' address for signing operations
						data: message,
						metadata: {
							description: `Sign personal message`,
							transactionType: "personal_sign",
							messageHash: message,
							signer: signerAddress,
						},
					},
				],
			};
		}

		case "eth_sign": {
			// Handle eth_sign - params: [address, message]
			const [signerAddress, message] = params as [`0x${string}`, `0x${string}`];

			return {
				version: "1.0",
				chainId: chainIdToHex(chainId),
				from: signerAddress,
				calls: [
					{
						data: message,
						metadata: {
							description: `Sign message with eth_sign`,
							transactionType: "eth_sign",
							messageHash: message,
							signer: signerAddress,
						},
					},
				],
			};
		}

		case "eth_signTypedData":
		case "eth_signTypedData_v4": {
			// Handle typed data signing - params: [address, typedDataJSON]
			const [signerAddress, typedDataJSON] = params as [`0x${string}`, string];

			let typedData: Record<string, unknown>;
			try {
				typedData = JSON.parse(typedDataJSON);
			} catch (error) {
				throw new Error(
					`Failed to parse typed data: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}

			// Encode the typed data as calldata
			const encodedData = toHex(
				Buffer.from(typedDataJSON, "utf-8"),
			) as `0x${string}`;

			return {
				version: "1.0",
				chainId: chainIdToHex(chainId),
				from: signerAddress,
				calls: [
					{
						data: encodedData,
						metadata: {
							description: `Sign typed data (${method === "eth_signTypedData_v4" ? "v4" : "v1"})`,
							transactionType: method,
							signer: signerAddress,
							typedDataHash: encodedData,
							domain: JSON.stringify(typedData.domain || {}),
						},
					},
				],
			};
		}

		default: {
			// Exhaustive type checking
			const exhaustiveCheck: never = method;
			throw new Error(`Unsupported signing method: ${exhaustiveCheck}`);
		}
	}
}

// Example usage with error handling
export async function handleEvmTransaction(
	toolResponse: GenerateEvmTxResponse,
	userAddress: `0x${string}`,
): Promise<
	| { success: true; data: WalletSendCallsParams }
	| { success: false; error: string }
> {
	try {
		const walletSendCalls = await convertEvmTxToWalletSendCalls(
			toolResponse,
			userAddress,
		);

		return {
			success: true,
			data: walletSendCalls,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		};
	}
}

// Utility function to validate and process the response from generate-evm-tx
export function validateEvmTxResponse(
	response: unknown,
): GenerateEvmTxResponse {
	// First, do a basic type check
	if (!response || typeof response !== "object") {
		throw new Error("Invalid response: not an object");
	}

	const responseObj = response as Record<string, unknown>;

	// Manually validate the required evmSignRequest field
	if (
		!responseObj.evmSignRequest ||
		typeof responseObj.evmSignRequest !== "object"
	) {
		throw new Error("Invalid response: missing or invalid evmSignRequest");
	}

	const evmSignRequest = responseObj.evmSignRequest as Record<string, unknown>;

	// Validate method
	const validMethods = [
		"eth_sendTransaction",
		"personal_sign",
		"eth_sign",
		"eth_signTypedData",
		"eth_signTypedData_v4",
	];
	if (!validMethods.includes(evmSignRequest.method as string)) {
		throw new Error(`Invalid method: ${evmSignRequest.method}`);
	}

	// Validate chainId
	if (typeof evmSignRequest.chainId !== "number") {
		throw new Error("Invalid chainId: must be a number");
	}

	// Params can be anything, we'll validate it later based on method
	if (!evmSignRequest.params) {
		throw new Error("Invalid response: missing params");
	}

	// Return the response as is, ui field is completely optional
	return {
		evmSignRequest: evmSignRequest as SignRequestData,
		ui: responseObj.ui as
			| SwapFTData
			| TransferFTData
			| Record<string, unknown>
			| undefined,
	};
}

// Helper to extract signer address from different methods
export function extractSignerAddress(
	evmSignRequest: SignRequestData,
): `0x${string}` {
	const { method, params } = evmSignRequest;

	switch (method) {
		case "eth_sendTransaction": {
			const transactions = params as Array<{ from: `0x${string}` }>;
			return (
				transactions[0]?.from ||
				("0x0000000000000000000000000000000000000000" as `0x${string}`)
			);
		}
		case "personal_sign": {
			const [, address] = params as [`0x${string}`, `0x${string}`];
			return address;
		}
		case "eth_sign": {
			const [address] = params as [`0x${string}`, `0x${string}`];
			return address;
		}
		case "eth_signTypedData":
		case "eth_signTypedData_v4": {
			const [address] = params as [`0x${string}`, string];
			return address;
		}
		default: {
			const exhaustiveCheck: never = method;
			throw new Error(`Unsupported method: ${exhaustiveCheck}`);
		}
	}
}
