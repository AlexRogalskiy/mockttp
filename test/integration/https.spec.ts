import { getLocal } from "../..";
import { expect, fetch, nodeOnly } from "../test-utils";

describe("An HTTPS server", () => {
    describe("passed key & cert paths", () => {

        let server = getLocal({
            https: {
                keyPath: './test/fixtures/test-ca.key',
                certPath: './test/fixtures/test-ca.pem'
            }
        });

        beforeEach(() => server.start());
        afterEach(() => server.stop());

        it("returns a HTTPS serverUrl", () => {
            expect(server.url.split('://')[0]).to.equal('https');
        });

        it("can handle HTTPS requests", async () => {
            await server.get('/').thenReply(200, "Super secure response");
            return expect(fetch(server.url)).to.have.responseText("Super secure response");
        });

        it("can handle HTTP requests", async () => {
            await server.get('/').thenReply(200, "Super secure response");
            return expect(fetch(server.url.replace('https', 'http'))).to.have.responseText("Super secure response");
        });
    });
});