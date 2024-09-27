const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');
const ffmpeg = require('fluent-ffmpeg');
const dotenv = require('dotenv');
dotenv.config();

// Diretório de backup do WhatsApp
const chatDirectory = "/Users/jbjares/Documents/kraterazapdriver/zapBKP_27092024/WhatsApp Chat - KRATERA";
const chatFile = path.join(chatDirectory, '_chat.txt');

// Diretórios locais para mídias
const localDirectories = {
    audio: process.env.LOCAL_AUDIO_DIR,
    image: process.env.LOCAL_IMAGE_DIR,
    video: process.env.LOCAL_VIDEO_DIR,
    text: process.env.LOCAL_TEXT_DIR,
    trash: process.env.LOCAL_TRASH_DIR
};

// Palavras-chave para identificar letras de músicas
const musicKeywords = ['letra', 'cifra', 'música', 'verso', 'estrofe', 'refrão'];

// Função para garantir que os diretórios existam
function ensureDirectoriesExist() {
    Object.values(localDirectories).forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

// Função para inicializar o cliente Google Drive com conta de serviço
async function getDriveClient() {
    const credentials = require(process.env.GOOGLE_SERVICE_ACCOUNT_PATH);
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

    if (response.data.id) {
        console.log(`Arquivo ${fileName} foi enviado ao Google Drive, ID: ${response.data.id}`);
    } else {
        console.error(`Erro ao enviar ${fileName} para o Google Drive.`);
    }
}

// Função para buscar letras de músicas no arquivo _chat.txt e extrair trechos relevantes
async function findMusicInChat() {
    console.log('Buscando músicas no arquivo _chat.txt...');
    const chatContent = fs.readFileSync(chatFile, 'utf-8');

    // Buscar por palavras-chave e salvar trechos identificados como músicas
    const lines = chatContent.split('\n');
    let musicTexts = [];
    let currentText = '';
    let foundMusic = false;

    lines.forEach(line => {
        if (musicKeywords.some(keyword => line.toLowerCase().includes(keyword))) {
            foundMusic = true;
            currentText += line + '\n';
        } else if (currentText && foundMusic) {
            musicTexts.push(currentText.trim());
            currentText = '';
            foundMusic = false;
        }
    });

    // Salvar trechos de letras de músicas localmente
    if (musicTexts.length > 0) {
        const randomId = Math.floor(Math.random() * 1000000000);
        const fileName = `letra_${randomId}.txt`;
        const filePath = path.join(localDirectories.text, fileName);
        fs.writeFileSync(filePath, musicTexts.join('\n\n'));
        console.log(`Letras de músicas salvas em ${filePath}`);

        // Fazer upload para o Google Drive
        const driveClient = await getDriveClient();
        await uploadToDrive(filePath, fileName, 'text/plain', driveClient, [process.env.ROOT_FOLDER_NAME, 'Letras']);
    } else {
        console.log('Nenhuma letra de música encontrada.');
    }
}

// Função para converter .opus para .mp3 e processar outras mídias
async function processMediaFiles() {
    console.log('Processando mídias no diretório de backup...');
    const mediaFiles = fs.readdirSync(chatDirectory);

    for (const file of mediaFiles) {
        const ext = path.extname(file).toLowerCase();
        const randomId = Math.floor(Math.random() * 1000000000);
        let fileName = `${path.basename(file, ext)}_${randomId}${ext}`;
        let filePath, folderStructure;

        const sourcePath = path.join(chatDirectory, file);

        if (ext === '.opus') {
            const mp3FileName = `audio_${randomId}.mp3`;
            filePath = path.join(localDirectories.audio, mp3FileName);

            // Converter .opus para .mp3
            await new Promise((resolve, reject) => {
                ffmpeg(sourcePath)
                    .toFormat('mp3')
                    .on('end', () => {
                        console.log(`Arquivo .opus convertido e salvo como ${filePath}`);
                        resolve();
                    })
                    .on('error', err => {
                        console.error(`Erro ao converter ${file}: ${err.message}`);
                        reject();
                    })
                    .save(filePath);
            });

            folderStructure = [process.env.ROOT_FOLDER_NAME, 'Audios'];
        } else if (['.mp3', '.wav', '.aac'].includes(ext)) {
            filePath = path.join(localDirectories.audio, fileName);
            folderStructure = [process.env.ROOT_FOLDER_NAME, 'Audios'];
            fs.copyFileSync(sourcePath, filePath);
        } else if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
            filePath = path.join(localDirectories.image, fileName);
            folderStructure = [process.env.ROOT_FOLDER_NAME, 'Imagens'];
            fs.copyFileSync(sourcePath, filePath);
        } else if (['.mp4', '.mov', '.avi'].includes(ext)) {
            filePath = path.join(localDirectories.video, fileName);
            folderStructure = [process.env.ROOT_FOLDER_NAME, 'Videos'];
            fs.copyFileSync(sourcePath, filePath);
        } else {
            filePath = path.join(localDirectories.trash, fileName);
            folderStructure = [process.env.ROOT_FOLDER_NAME, 'Trash'];
            fs.copyFileSync(sourcePath, filePath);
        }

        console.log(`Mídia processada e salva como ${filePath}`);

        // Fazer upload para o Google Drive
        const driveClient = await getDriveClient();
        await uploadToDrive(filePath, fileName, 'application/octet-stream', driveClient, folderStructure);
    }
}

// Executar as funções
ensureDirectoriesExist();
findMusicInChat().then(() => {
    processMediaFiles().then(() => {
        console.log('Processamento concluído.');
    });
});
