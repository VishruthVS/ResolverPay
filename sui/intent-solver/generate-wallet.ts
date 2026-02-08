import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';

console.log('\n🔑 Generating new Sui wallet...\n');

const keypair = Ed25519Keypair.generate();
const address = keypair.getPublicKey().toSuiAddress();
const privateKey = keypair.export().privateKey;

console.log('Address:', address);
console.log('Private Key:', privateKey);
console.log('\n⚠️  KEEP THIS PRIVATE KEY SECURE!\n');
