import { teardownTestHost } from "./host-fixture.ts";

async function globalTeardown(): Promise<void> {
  await teardownTestHost();
}

export default globalTeardown;
