const zokrates = require('./zokrates');
const cv = require('./compute-vectors');
const utils = require('./utils');
const config = require('./config');
const zkp = require('./daap-zkp');
const jsonfile = require('jsonfile');
const fs = require('fs');
const conf = require('../../web3/config');
const path = require('path');
const Contract = require('../../web3/contract');
const Element = require('./Element');
let container;

async function getVkIds() {
    let vkIds = {};
    const vkIdsFile = path.join(path.resolve(__dirname), 'vkIds.json');
    if (fs.existsSync(vkIdsFile)) {
        console.log('从json文件中读取vkIds...');
        try {
            vkIds = await jsonfile.readFile(vkIdsFile);
        } catch (err) {
            console.log('读取vkIds失败：', err);
            return {}
        }
        return vkIds;
    } else {
        console.log('vkIds文件不存在');
        return {}
    }
}

async function computeProof(elements, hostDir) {
    if (!container) {
        container = await zokrates.runContainerMounted('code');
    }

    await zokrates.computeWitness(container, cv.computeVectors(elements), hostDir);

    const proof = await zokrates.generateProof(container, undefined, hostDir);

    console.group(`Proof: ${JSON.stringify(proof, undefined, 2)}`);
    console.groupEnd();

    await zokrates.killContainer(container);
    container = null; // clear out the container for the next run
    console.log('容器已杀死！');
    return proof;
}

function parseProof(proof) {
    proof = Object.values(proof);
    // convert to flattened array:
    proof = utils.flattenDeep(proof);
    // convert to decimal, as the solidity functions expect uints
    proof = proof.map(el => utils.hexToDec(el));
    console.log('proof计算结果：', proof);
    return proof
}

async function orgRegister(pk_A, sk_A, vkId, name, addr, account) {
    console.group('\n正在 注册组织...');
    const verifier = new Contract('GM17_v0');
    const verifier_registry = new Contract('Verifier_Registry');
    const organization = new Contract('Organization');
    console.log('Organization 合约地址：', organization.address);
    console.log('Verifier 合约地址：', verifier.address);
    console.log('Verifier_Registry 合约地址：', verifier_registry.address);
    console.groupEnd();

    console.group('已知的 Proof 变量：');
    const p = config.ZOKRATES_PACKING_SIZE; // packing size in bits
    const pt = Math.ceil((config.INPUTS_HASHLENGTH * 8) / config.ZOKRATES_PACKING_SIZE); // packets in bits
    console.log('pk_A:', pk_A, ' : ', utils.hexToFieldPreserve(pk_A, p, pt));
    console.groupEnd();

    const inputs = cv.computeVectors([new Element(pk_A, 'field', p, pt)]);
    console.log('公开inputs:');
    console.log(inputs);

    const hostDir = config.ORG_REG_DIR;

    // compute the proof
    console.group('计算proof：w=[sk_A] x=[pk_A]');
    let proof = await computeProof(
        [
            new Element(pk_A, 'field', p, pt),
            new Element(sk_A, 'field', p, pt),
        ],
        hostDir,
    );

    proof = parseProof(proof);
    await zkp.orgRegister(proof, inputs, vkId, name, addr, account, organization);

    // CHECK!!!!
    const registry = await verifier.call('getRegistry');
    console.log('检查verifier是否已经注册:', registry);

    console.log('组织注册完成！\n');
    console.groupEnd();
}

async function OrgRegister(name) {
    let vkIds = await getVkIds();
    let pk_A = config.PK_A;
    let sk_A = config.SK_A;
    let account = conf.accounts[0].address;
    let addr = conf.accounts[1].address;
    await orgRegister(pk_A, sk_A, vkIds['org-register'].vkId, name, addr, account)
}

async function assetRegister(sk_A, S_A, assetId, vkId, account) {
    console.group('\n正在注册资产...');
    const verifier = new Contract('GM17_v0');
    const verifier_registry = new Contract('Verifier_Registry');
    const shield = new Contract('Shield');
    console.log('Shield 合约地址：', shield.address);
    console.log('Verifier 合约地址：', verifier.address);
    console.log('Verifier_Registry 合约地址：', verifier_registry.address);
    console.groupEnd();

    let R_A = utils.concatenateThenHash(assetId, utils.hash(sk_A));
    R_A = utils.concatenateThenHash(R_A, S_A);

    console.group('已知的 Proof 变量：');
    const p = config.ZOKRATES_PACKING_SIZE; // packing size in bits
    const pt = Math.ceil((config.INPUTS_HASHLENGTH * 8) / config.ZOKRATES_PACKING_SIZE); // packets in bits
    console.log('sk_A:', sk_A, ' : ', utils.hexToFieldPreserve(sk_A, p, pt));
    console.log('S_A:', S_A, ' : ', utils.hexToFieldPreserve(S_A, p, pt));
    console.log('assetId:', assetId, ' : ', utils.hexToFieldPreserve(assetId, p, pt));
    console.groupEnd();

    console.group('新的Proof变量:');
    console.log('R_A: ', R_A, ' : ', utils.hexToFieldPreserve(R_A, p, pt));
    console.groupEnd();


    const inputs = cv.computeVectors([new Element(R_A, 'field', p, pt), new Element(assetId, 'field', p, pt)]);
    console.log('公开inputs:');
    console.log(inputs);

    const hostDir = config.ASSET_REG_DIR;

    // compute the proof
    console.group('计算proof：w=[sk_A] x=[R_A, assetId]');
    let proof = await computeProof(
        [
            new Element(R_A, 'field', p, pt),
            new Element(assetId, 'field', p, pt),
            new Element(sk_A, 'field', p, pt),
            new Element(S_A, 'field', p, pt),
        ],
        hostDir,
    );

    proof = parseProof(proof);
    await zkp.assetRegister(proof, inputs, vkId, account, shield);

    // CHECK!!!!
    const registry = await verifier.call('getRegistry');
    console.log('检查verifier是否已经注册:', registry);

    console.log('资产注册完成！\n');
    console.groupEnd();
    return [assetId, R_A, S_A]
}

async function AssetRegister() {
    let vkIds = await getVkIds();
    let sk_A = config.SK_A;
    let assetId = await utils.rndHex(32);
    let S_A = await utils.rndHex(32);
    let account = conf.accounts[0].address;
    return await assetRegister(sk_A, S_A, assetId, vkIds['asset-register'].vkId, account);
}

async function assetAuth(pk_B, sk_A, S_A, S_AB, assetId, R_A, vkId, account) {
    console.group('\n正在进行资产授权...');
    const verifier = new Contract('GM17_v0');
    const verifier_registry = new Contract('Verifier_Registry');
    const shield = new Contract('Shield');
    console.log('Shield 合约地址：', shield.address);
    console.log('Verifier 合约地址：', verifier.address);
    console.log('Verifier_Registry 合约地址：', verifier_registry.address);
    console.groupEnd();

    const root = await shield.call('regLatestRoot'); // solidity getter for the public variable latestRoot
    console.log(`Registry Merkle Root: ${root}`);

    let Z_B = utils.concatenateThenHash(assetId, pk_B);
    Z_B = utils.concatenateThenHash(Z_B, utils.hash(sk_A));
    Z_B = utils.concatenateThenHash(Z_B, S_AB);
    let R_A_index = await shield.call('regCommitmentIndex', [R_A]);
    if (R_A_index === 0) {
        throw new Error('不存在的commitment')
    }
    R_A_index--;
    // we need the Merkle path from the token commitment to the root, expressed as Elements
    const path = await cv.computePath(account, shield, R_A, R_A_index, 0).then(result => {
        return {
            elements: result.path.map(
                element => new Element(element, 'field', config.MERKLE_HASHLENGTH * 8, 1),
            ),
            positions: new Element(result.positions, 'field', 128, 1),
        };
    });

    // check the path and root match:
    if (path.elements[0].hex !== root) {
        throw new Error(`默克尔树Root不相等: sister-path[0]=${path.elements[0].hex} root=${root}`);
    }

    console.group('已知的 Proof 变量：');
    const p = config.ZOKRATES_PACKING_SIZE; // packing size in bits
    const pt = Math.ceil((config.INPUTS_HASHLENGTH * 8) / config.ZOKRATES_PACKING_SIZE); // packets in bits
    console.log('pk_B:', pk_B, ' : ', utils.hexToFieldPreserve(sk_A, p, pt));
    console.log('sk_A:', sk_A, ' : ', utils.hexToFieldPreserve(sk_A, p, pt));
    console.log('assetId:', assetId, ' : ', utils.hexToFieldPreserve(assetId, p, pt));
    console.groupEnd();

    console.group('新的Proof变量:');
    console.log('Z_B: ', Z_B, ' : ', utils.hexToFieldPreserve(Z_B, p, pt));
    console.groupEnd();


    const inputs = cv.computeVectors([new Element(Z_B, 'field', p, pt), new Element(root, 'field', p, pt)]);
    console.log('公开inputs:');
    console.log(inputs);

    const hostDir = config.ASSET_AUTH_DIR;

    // compute the proof
    console.group('计算proof：w=[pk_B, sk_A, assetId, path] x=[Z_B, root]');
    let proof = await computeProof(
        [
            new Element(Z_B, 'field', p, pt),
            new Element(root, 'field', p, pt),
            ...path.elements.slice(1),
            path.positions,
            new Element(sk_A, 'field', p, pt),
            new Element(pk_B, 'field', p, pt),
            new Element(assetId, 'field', p, pt),
            new Element(S_A, 'field', p, pt),
            new Element(S_AB, 'field', p, pt),
        ],
        hostDir,
    );

    proof = parseProof(proof);
    await zkp.assetAuth(proof, inputs, vkId, account, shield);

    // CHECK!!!!
    const registry = await verifier.call('getRegistry');
    console.log('检查verifier是否已经注册:', registry);

    console.log('资产授权完成！\n');
    console.groupEnd();
}

async function AssetAuth(assetId, S_A, R_A) {
    let vkIds = await getVkIds();
    let sk_A = config.SK_A;
    let pk_B = config.PK_B;
    let S_AB = await utils.rndHex(32);
    let account = conf.accounts[0].address;
    await assetAuth(pk_B, sk_A, S_A, S_AB, assetId, R_A, vkIds['asset-auth'].vkId, account)
}

async function runController() {
    await OrgRegister('原本');
    console.log('成功执行组织注册！');
    let [assetId, R_A, S_A] = await AssetRegister();
    console.log('成功执行资产注册！');
    await AssetAuth(assetId, S_A, R_A);
    console.log('成功执行资产授权！');
}

runController().then(() => {
    console.log('成功执行所有操作！');
    process.exit()
});
