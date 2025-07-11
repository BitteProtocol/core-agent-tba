import type { ToolInvocation } from "ai";
import { parseEther, toHex } from "viem/utils";

export const extractEvmTxCall = (
	toolCall: ToolInvocation,
	addressFromInboxId: string,
) => {
	const params = toolCall?.args?.params || [];
	const chainId = toolCall?.args?.chainId;
	const chainIdHex = toHex(Number.parseInt(chainId || "8453"));
	const method = toolCall?.args?.method;

	// Extract all calls from the params array
	const calls = params.map(
		(param: {
			to?: string;
			data?: string;
			value?: string;
			gas?: string;
			from?: string;
		}) => {
			const valueParam = param?.value;
			const valueHex = valueParam?.startsWith("0x")
				? valueParam
				: toHex(parseEther(valueParam || "0"));

			return {
				to: param?.to,
				data: param?.data,
				value: valueHex,
				gas: param?.gas,
				metadata: {
					description: method || "bitte tx",
					transactionType: method || "transfer",
				},
			};
		},
	);

	// Get the 'from' address from the first param or use default
	const fromParam = params[0]?.from;

	return {
		version: "1.0.0",
		chainId: chainIdHex,
		from: fromParam || addressFromInboxId,
		calls: calls,
	} as const;
};
