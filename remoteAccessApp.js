const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');
const qrcode = require('qrcode-terminal');
const dotenv = require('dotenv');
dotenv.config();

// Carregar variáveis do .env
const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;

// Diretórios locais para download, definidos no .env
const localDirectories = {
    audio: process.env.LOCAL_AUDIO_DIR,
    image: process.env.LOCAL_IMAGE_DIR,
    video: process.env.LOCAL_VIDEO_DIR,
    text: process.env.LOCAL_TEXT_DIR,
    trash: process.env.LOCAL_TRASH_DIR
};

// Função para garantir que os diretórios existam
function ensureDirectoriesExist() {
    Object.values(localDirectories).forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

// Função para gerar um ID aleatório
function generateRandomId() {
    return Math.floor(Math.random() * 1000000000);
}

// Função para inicializar o cliente Google Drive com conta de serviço
async function getDriveClient() {
    const credentials = require(serviceAccountPath);
    const auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    return google.drive({ version: 'v3', auth });
}

// Função para criar diretório no Google Drive se não existir
async function createDriveFolderIfNotExists(driveClient, folderName, parentId = 'root') {
    const response = await driveClient.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents`,
        fields: 'files(id, name)',
    });
    if (response.data.files.length > 0) {
        return response.data.files[0].id;
    } else {
        const folder = await driveClient.files.create({
            resource: {
                'name': folderName,
                'mimeType': 'application/vnd.google-apps.folder',
                'parents': [parentId],
            },
            fields: 'id',
        });
        console.log(`Pasta criada no Google Drive: ${folderName}`);
        return folder.data.id;
    }
}

// Função para fazer upload para o Google Drive mantendo a estrutura de pastas
async function uploadToDrive(filePath, fileName, mimeType, driveClient, folderStructure) {
    let parentId = 'root';
    for (const folder of folderStructure) {
        parentId = await createDriveFolderIfNotExists(driveClient, folder, parentId);
    }
    const fileMetadata = {
        'name': fileName,
        'parents': [parentId],
    };
    const media = {
        mimeType: mimeType,
        body: fs.createReadStream(filePath),
    };
    const response = await driveClient.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id',
    });
    console.log(`Arquivo ${fileName} foi enviado ao Google Drive, ID: ${response.data.id}`);
}

// Inicializar cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true }
});

// Gerar QR code para login no WhatsApp Web
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('Escaneie o QR code para autenticar');
});

// Quando o cliente estiver pronto
client.on('ready', async () => {
    console.log('Cliente WhatsApp pronto!');
    ensureDirectoriesExist();

    // Procurar pelo grupo KRATERA
    const chats = await client.getChats();
    const groupChat = chats.find(chat => chat.isGroup && chat.name === 'KRATERA');

    if (!groupChat) {
        console.error('Grupo KRATERA não encontrado.');
        return;
    }

    // Função para varrer todas as mensagens
    async function fetchAllMessages(groupChat) {
        let lastMessageId = null;
        let hasMoreMessages = true;
        let allMessages = [];

        while (hasMoreMessages) {
            try {
                const messages = await groupChat.fetchMessages({ limit: 50, before: lastMessageId });

                if (messages.length === 0) {
                    hasMoreMessages = false;
                    console.log('Fim do histórico de mensagens do grupo.');
                } else {
                    lastMessageId = messages[messages.length - 1].id._serialized;
                    allMessages = allMessages.concat(messages);
                    console.log('Mensagens obtidas: ', allMessages.length);
                }
            } catch (error) {
                console.error('Erro ao buscar mensagens:', error);
                hasMoreMessages = false;
            }
        }

        return allMessages;
    }

    // Buscar todas as mensagens do grupo KRATERA
    const allMessages = await fetchAllMessages(groupChat);

    // Processar e baixar as mídias
    for (const message of allMessages) {
        if (message.hasMedia) {
            const media = await message.downloadMedia();
            const randomId = generateRandomId();
            let filePath, folderStructure;

            // Determinar o tipo de mídia
            if (media.mimetype.startsWith('audio')) {
                const fileName = `audio_${randomId}.mp3`;
                filePath = path.join(localDirectories.audio, fileName);
                folderStructure = [process.env.ROOT_FOLDER_NAME, 'Audios'];
            } else if (media.mimetype.startsWith('image')) {
                const fileName = `imagem_${randomId}.jpeg`;
                filePath = path.join(localDirectories.image, fileName);
                folderStructure = [process.env.ROOT_FOLDER_NAME, 'Imagens'];
            } else if (media.mimetype.startsWith('video')) {
                const fileName = `video_${randomId}.mp4`;
                filePath = path.join(localDirectories.video, fileName);
                folderStructure = [process.env.ROOT_FOLDER_NAME, 'Videos'];
            } else {
                const fileName = `desconhecido_${randomId}${path.extname(media.filename)}`;
                filePath = path.join(localDirectories.trash, fileName);
                folderStructure = [process.env.ROOT_FOLDER_NAME, 'Trash'];
            }

            // Salvar a mídia localmente
            fs.writeFileSync(filePath, media.data, 'base64');
            console.log(`Mídia salva localmente: ${filePath}`);

            // Upload para o Google Drive
            const driveClient = await getDriveClient();
            await uploadToDrive(filePath, path.basename(filePath), media.mimetype, driveClient, folderStructure);
        }
    }

    console.log('Processo de download de mídias concluído.');
});

// Inicializar o cliente WhatsApp
client.initialize();
