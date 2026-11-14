/** Every test file starts with the deterministic synchronous fake as the room's crypto (see tests/fake-crypto.ts). Production never loads this file. */
import { setCrewCrypto } from '../src/net/sign';
import { fakeCrypto } from './fake-crypto';

setCrewCrypto(fakeCrypto);
