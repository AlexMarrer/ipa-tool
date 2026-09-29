/**
 * Global setup of `npm run test:live`: like `npm test`, but `claude` stays on the PATH.
 */
import { createSetup } from './global-setup.js';

export default createSetup({ hideClaude: false });
