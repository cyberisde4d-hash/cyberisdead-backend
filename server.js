import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import axios from "axios";
import fs from "fs";
import tumblr from "tumblr.js";

const client = tumblr.createClient({
  consumer_key: process.env.TUMBLR_CONSUMER_KEY,
  consumer_secret: process.env.TUMBLR_CONSUMER_SECRET,
  token: process.env.TUMBLR_TOKEN,
  token_secret: process.env.TUMBLR_TOKEN_SECRET
});

const app = express();

app.use(express.json());
app.use(cors());

const upload = multer({
  dest: "uploads/"
});

const uploadCover = multer({
  dest: "uploads/"
});


// ======================================================
// UPLOAD DA CAPA PARA O TUMBLR
// ======================================================

app.post(
  "/api/upload-cover",
  uploadCover.single("cover"),
  async (req, res) => {
    let filePath = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          message: "Nenhuma capa foi enviada."
        });
      }

      filePath = req.file.path;

      const response = await client.createPost("cyberisdead", {
        content: [
          {
            type: "image",
            media: fs.createReadStream(filePath)
          }
        ]
      });

      console.log("Capa publicada no Tumblr.");
      console.log("Post ID:", response.id);

      const posts = await client.blogPosts("cyberisdead", {
        limit: 1
      });

      const post = posts.posts?.[0];

      if (!post) {
        throw new Error("Não encontrei o post publicado.");
      }

      const match = post.body?.match(
        /https:\/\/64\.media\.tumblr\.com\/[^"]+/
      );

      if (!match) {
        throw new Error("Não encontrei a URL direta da imagem.");
      }

      const coverUrl = match[0];

      console.log("URL direta da capa:");
      console.log(coverUrl);

      res.json({
        ok: true,
        coverUrl
      });

    } catch (error) {
      console.error("Erro no upload da capa:", error);

      res.status(500).json({
        ok: false,
        message: error.response?.body || error.message
      });

    } finally {
      if (filePath) {
        try {
          await fs.promises.unlink(filePath);
        } catch (cleanupError) {
          console.error(
            "Não foi possível remover a capa temporária:",
            cleanupError.message
          );
        }
      }
    }
  }
);


// ======================================================
// UPLOAD DO ÁUDIO PARA O SUBSTACK
// ======================================================

app.post(
  "/api/upload-audio",
  upload.single("audio"),
  async (req, res) => {
    let filePath = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          message: "Nenhum áudio foi enviado."
        });
      }

      const fileName = req.file.originalname;
      filePath = req.file.path;
      const fileSize = req.file.size;

      const cookie =
        `substack.sid=${process.env.SUBSTACK_COOKIE}; ` +
        `substack.lli=${process.env.SUBSTACK_LLI}`;

      const headers = {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        Referer: "https://cyberisdead.substack.com/"
      };

      console.log("Iniciando upload para o Substack...");
      console.log("Arquivo:", fileName);
      console.log("Tamanho:", fileSize);


      // ==================================================
      // 1. Cria o upload no Substack
      // ==================================================

      const uploadResponse = await axios.post(
        "https://cyberisdead.substack.com/api/v1/audio/upload",
        null,
        {
          params: {
            filetype: "audio/wav",
            fileSize,
            fileName,
            post_id: process.env.SUBSTACK_POST_ID
          },
          headers
        }
      );

      const mediaUpload =
        uploadResponse.data?.mediaUpload;

      const multipartUploadId =
        uploadResponse.data?.multipartUploadId;

      const multipartUploadUrls =
        uploadResponse.data?.multipartUploadUrls;

      if (
        !mediaUpload?.id ||
        !multipartUploadId ||
        !Array.isArray(multipartUploadUrls) ||
        multipartUploadUrls.length === 0
      ) {
        throw new Error(
          "Substack não retornou os dados do upload multipart."
        );
      }

      const uploadId = mediaUpload.id;

      console.log("Upload criado.");
      console.log("Upload ID:", uploadId);
      console.log("Partes:", multipartUploadUrls.length);


      // ==================================================
      // 2. Divide o arquivo nas partes
      // ==================================================

      const partSize = Math.ceil(
        fileSize / multipartUploadUrls.length
      );

      const etags = [];

      for (
        let i = 0;
        i < multipartUploadUrls.length;
        i++
      ) {
        const start = i * partSize;

        const end = Math.min(
          fileSize - 1,
          start + partSize - 1
        );

        const currentPartSize =
          end - start + 1;

        console.log(
          `Enviando parte ${i + 1}/${multipartUploadUrls.length}...`
        );

        const stream = fs.createReadStream(
          filePath,
          {
            start,
            end
          }
        );

        const partResponse = await axios.put(
          multipartUploadUrls[i],
          stream,
          {
            headers: {
              "Content-Length": currentPartSize
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity
          }
        );

        const etag =
          partResponse.headers.etag;

        if (!etag) {
          throw new Error(
            `Substack não retornou ETag da parte ${i + 1}.`
          );
        }

        etags.push(etag);

        console.log(
          `Parte ${i + 1} concluída.`
        );
      }


      // ==================================================
      // 3. Manda o Substack processar o áudio
      // ==================================================

      console.log(
        "Enviando partes para transcodificação..."
      );

      await axios.post(
        `https://cyberisdead.substack.com/api/v1/audio/upload/${uploadId}/transcode`,
        {
          duration: null,
          multipart_upload_etags: etags,
          multipart_upload_id: multipartUploadId
        },
        {
          headers: {
            ...headers,
            "Content-Type": "application/json"
          }
        }
      );

      console.log(
        "Transcodificação iniciada."
      );


      // ==================================================
      // 4. Aguarda o Substack terminar
      // ==================================================

      let uploadStatus = null;

      for (
        let attempt = 1;
        attempt <= 60;
        attempt++
      ) {
        await new Promise(
          resolve => setTimeout(resolve, 5000)
        );

        const statusResponse =
          await axios.get(
            `https://cyberisdead.substack.com/api/v1/audio/upload/${uploadId}`,
            {
              headers
            }
          );

        uploadStatus =
          statusResponse.data;

        console.log(
          `Status do áudio (${attempt}/60):`,
          uploadStatus?.state,
          uploadStatus?.uploaded_at
        );

        if (uploadStatus?.uploaded_at) {
          break;
        }
      }

      if (!uploadStatus?.uploaded_at) {
        throw new Error(
          "O Substack ainda não terminou de processar o áudio."
        );
      }


      // ==================================================
      // 5. Obtém o token privado do podcast
      // ==================================================

      const rssResponse =
        await axios.get(
          "https://cyberisdead.substack.com/api/v1/subscription/podcast_rss_url?section_id",
          {
            headers
          }
        );

      const rssUrl =
        rssResponse.data?.podcast_rss_url;

      if (!rssUrl) {
        throw new Error(
          "Substack não retornou a URL privada do podcast."
        );
      }

      const token =
        rssUrl
          .split("/private/")[1]
          ?.replace(".rss", "");

      if (!token) {
        throw new Error(
          "Não foi possível extrair o token do podcast."
        );
      }


      // ==================================================
      // 6. Pega a URL final do áudio
      // ==================================================

      const audioResponse =
        await axios.get(
          `https://api.substack.com/api/v1/audio/upload/${uploadId}/src`,
          {
            params: {
              token
            },
            headers,
            maxRedirects: 0,
            validateStatus:
              status => status === 307
          }
        );

      const audioUrl =
        audioResponse.headers.location;

      if (!audioUrl) {
        throw new Error(
          "Substack não retornou a URL final do áudio."
        );
      }

      console.log(
        "Áudio processado com sucesso."
      );

      res.json({
        ok: true,
        audioUrl
      });

    } catch (error) {
      console.error(
        "Erro no upload para o Substack:",
        error
      );

      res.status(
        error.response?.status || 500
      ).json({
        ok: false,
        message:
          error.response?.data?.message ||
          error.response?.data ||
          error.message
      });

    } finally {
      if (filePath) {
        try {
          await fs.promises.unlink(filePath);

          console.log(
            "Arquivo temporário removido."
          );

        } catch (cleanupError) {
          console.error(
            "Não foi possível remover o arquivo temporário:",
            cleanupError.message
          );
        }
      }
    }
  }
);


// ======================================================
// TESTES
// ======================================================

app.get("/", (req, res) => {
  res.send(
    "Backend CYBERISDEAD funcionando."
  );
});


app.get("/api/test", (req, res) => {
  res.json({
    ok: true,
    message: "API CYBERISDEAD funcionando."
  });
});


app.get("/api/substack-config", (req, res) => {
  res.json({
    ok: true,
    publication:
      process.env.SUBSTACK_PUBLICATION || null,
    postId:
      process.env.SUBSTACK_POST_ID || null
  });
});


// ======================================================
// TESTE RSS SUBSTACK
// ======================================================

app.get(
  "/api/substack-rss-test",
  async (req, res) => {
    try {
      const response =
        await axios.get(
          "https://cyberisdead.substack.com/api/v1/subscription/podcast_rss_url?section_id",
          {
            headers: {
              Cookie:
                `substack.sid=${process.env.SUBSTACK_COOKIE}; ` +
                `substack.lli=${process.env.SUBSTACK_LLI}`,
              "User-Agent": "Mozilla/5.0",
              Referer:
                "https://cyberisdead.substack.com/"
            }
          }
        );

      res.json({
        ok: true,
        data: response.data
      });

    } catch (error) {
      res.status(
        error.response?.status || 500
      ).json({
        ok: false,
        status:
          error.response?.status || null,
        message:
          error.response?.data ||
          error.message
      });
    }
  }
);


// ======================================================
// OBTER URL DE ÁUDIO PELO UPLOAD ID
// ======================================================

app.get(
  "/api/substack-audio-url/:uploadId",
  async (req, res) => {
    try {
      const uploadId =
        req.params.uploadId;


      // 1. Descobre a URL privada do podcast

      const rssResponse =
        await axios.get(
          "https://cyberisdead.substack.com/api/v1/subscription/podcast_rss_url?section_id",
          {
            headers: {
              Cookie:
                `substack.sid=${process.env.SUBSTACK_COOKIE}; ` +
                `substack.lli=${process.env.SUBSTACK_LLI}`,
              "User-Agent": "Mozilla/5.0",
              Referer:
                "https://cyberisdead.substack.com/"
            }
          }
        );

      const rssUrl =
        rssResponse.data?.podcast_rss_url;

      if (!rssUrl) {
        return res.status(500).json({
          ok: false,
          message:
            "Substack não retornou a URL privada do podcast."
        });
      }


      // 2. Extrai o token

      const token =
        rssUrl
          .split("/private/")[1]
          ?.replace(".rss", "");

      if (!token) {
        return res.status(500).json({
          ok: false,
          message:
            "Não foi possível extrair o token do podcast."
        });
      }


      // 3. Consulta o áudio

      const audioResponse =
        await axios.get(
          `https://api.substack.com/api/v1/audio/upload/${uploadId}/src`,
          {
            params: {
              token
            },
            headers: {
              Cookie:
                `substack.sid=${process.env.SUBSTACK_COOKIE}; ` +
                `substack.lli=${process.env.SUBSTACK_LLI}`,
              "User-Agent": "Mozilla/5.0",
              Referer:
                "https://cyberisdead.substack.com/"
            },
            maxRedirects: 0,
            validateStatus:
              status => status === 307
          }
        );

      const audioUrl =
        audioResponse.headers.location;

      res.json({
        ok: true,
        audioUrl
      });

    } catch (error) {
      res.status(
        error.response?.status || 500
      ).json({
        ok: false,
        status:
          error.response?.status || null,
        message:
          error.response?.data ||
          error.message
      });
    }
  }
);

app.get("/api/audio-proxy", async (req,res)=>{
  console.log("AUDIO PROXY NOVO ATIVO");

  res.setHeader(
  "X-Test-Proxy",
  "novo"
);

  try {
    const url = req.query.url;

    if(!url){
      return res.status(400).send("URL ausente");
    }

    const headers = {
      "User-Agent":"Mozilla/5.0",
      "Accept":"audio/mpeg"
    };

    if(req.headers.range){
      headers.Range = req.headers.range;
    }

    const response = await axios.get(url,{
      responseType:"stream",
      headers,
      validateStatus:(status)=>[
        200,
        206
      ].includes(status)
    });


    res.status(response.status);

res.setHeader(
  "Content-Type",
  "audio/mpeg"
);

res.setHeader(
  "Accept-Ranges",
  "bytes"
);

if(response.headers["content-range"]){
  res.setHeader(
    "Content-Range",
    response.headers["content-range"]
  );
}

if(response.headers["content-length"]){
  res.setHeader(
    "Content-Length",
    response.headers["content-length"]
  );
}

res.setHeader(
  "Cache-Control",
  "public,max-age=3600"
);

res.setHeader(
  "Content-Disposition",
  "inline"
);

response.data.pipe(res);


  } catch(error){

    console.error(
      "ERRO PROXY:",
      error.message
    );

    res.status(500)
      .send("Erro no proxy de áudio");
  }
});

// ======================================================
// INICIA O SERVIDOR
// ======================================================

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Backend rodando na porta ${PORT}`
  );
});