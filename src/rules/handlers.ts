/**
 * @module MockRuleData
 */

import _ = require('lodash');
import url = require('url');
import http = require('http');
import https = require('https');
import express = require("express");
import { OngoingRequest } from "../types";
import { RequestHandler } from "./mock-rule-types";

export type HandlerData = (
    SimpleHandlerData |
    CallbackHandlerData |
    PassThroughHandlerData
);

export type HandlerType = HandlerData['type'];

export type HandlerDataLookup = {
    'simple': SimpleHandlerData,
    'callback': CallbackHandlerData,
    'passthrough': PassThroughHandlerData
}

export class SimpleHandlerData {
    readonly type: 'simple' = 'simple';

    constructor(
        public status: number,
        public data?: string,
        public headers?: http.OutgoingHttpHeaders
    ) {}
}

export class CallbackHandlerData {
    readonly type: 'callback' = 'callback';

    constructor(
        public callback: Function
    ) {}
}

export class PassThroughHandlerData {
    readonly type: 'passthrough' = 'passthrough';
}

type HandlerBuilder<D extends HandlerData> = (data: D) => RequestHandler;

export function buildHandler
    <T extends HandlerType, D extends HandlerDataLookup[T]>
    (handlerData: D): RequestHandler
{
    // Neither of these casts should really be required imo, seem like TS bugs
    const type = <T> handlerData.type;
    const builder = <HandlerBuilder<D>> handlerBuilders[type];
    return builder(handlerData);
}

const handlerBuilders: { [T in HandlerType]: HandlerBuilder<HandlerDataLookup[T]> } = {
    simple: ({ data, status, headers }: SimpleHandlerData): RequestHandler => {
        let responder = _.assign(async function(request: OngoingRequest, response: express.Response) {
            response.writeHead(status, headers);
            response.end(data || "");
        }, { explain: () => `respond with status ${status}` + (headers ? `, headers ${JSON.stringify(headers)}` : "") + (data ? ` and body "${data}"` : "") });
        return responder;
    },
    callback: ({callback}: CallbackHandlerData): RequestHandler => {
        let responder = _.assign(async function(request: OngoingRequest, response: express.Response) {
            let buffer, text, json, formData;
            try {
                buffer = await request.body.asBuffer();
            } catch (err) {
                buffer = undefined;
            }
            try {
                text = await request.body.asText();
            } catch (err) {
                text = undefined;
            }
            try {
                json = await request.body.asJson();
            } catch (err) {
                json = undefined;
            }
            try {
                formData = await request.body.asFormData();
            } catch (err) {
                formData = undefined;
            }
            const cleanRequest = {
                protocol: request.protocol,
                method: request.method,
                url: request.url,
                hostname: request.hostname,
                path: request.path,
                headers: request.headers,
                body: { buffer, text, json, formData }
            }
            let ourResponse;
            try {
                ourResponse = await callback(cleanRequest);
            } catch (err) {
                throw err;
            }
            if (typeof ourResponse.body === 'object') {
                ourResponse.body = JSON.stringify(ourResponse.body);
            }
            const defaultResponse = {
                status: 200,
                body: '',
                headers: {},
                ...ourResponse
            };
            response.writeHead(defaultResponse.status, defaultResponse.headers);
            response.end(defaultResponse.body || "");
        }, { explain: () => `respond for callback ${callback.toString()}` });
        return responder;
    },
    passthrough: (): RequestHandler => {
        return _.assign(async function(clientReq: OngoingRequest, clientRes: express.Response) {
            const { method, originalUrl, headers } = clientReq;
            const { protocol, hostname, port, path } = url.parse(originalUrl);

            if (!hostname) {
                throw new Error(
`Cannot pass through request to ${clientReq.url}, since it doesn't specify an upstream host.
To pass requests through, use the mock server as a proxy whilst making requests to the real target server.`);
            }

            let makeRequest = protocol === 'https:' ? https.request : http.request;

            return new Promise<void>((resolve, reject) => {
                let serverReq = makeRequest({
                    protocol,
                    method,
                    hostname,
                    port,
                    path,
                    headers
                }, (serverRes) => {
                    Object.keys(serverRes.headers).forEach((header) => {
                        try {
                            clientRes.setHeader(header, serverRes.headers[header]!);
                        } catch (e) {
                            // A surprising number of real sites have slightly invalid headers (e.g. extra spaces)
                            // If we hit any, just drop that header and print a message.
                            console.log(`Error setting header on passthrough response: ${e.message}`);
                        }
                    });

                    clientRes.status(serverRes.statusCode!);

                    serverRes.pipe(clientRes);
                    serverRes.on('end', resolve);
                    serverRes.on('error', reject);
                });

                clientReq.body.rawStream.pipe(serverReq);

                serverReq.on('error', (e: any) => {
                    e.statusCode = 502;
                    e.statusMessage = 'Error communicating with upstream server';
                    reject(e);
                });
            });
        }, { explain: () => 'pass the request through to the real server' });
    }
};