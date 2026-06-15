interface NetlifyEventLike {
    httpMethod?: string;
}
export declare function handler(event?: NetlifyEventLike): Promise<{
    statusCode: number;
    headers: {
        "Access-Control-Allow-Origin": string;
        "Access-Control-Allow-Headers": string;
        "Access-Control-Allow-Methods": string;
    };
    body: string;
}>;
export {};
