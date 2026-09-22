import "dotenv/config";

import tumblr from "tumblr.js";

import fs from "fs";

const client = tumblr.createClient({
  consumer_key: process.env.TUMBLR_CONSUMER_KEY,
  consumer_secret: process.env.TUMBLR_CONSUMER_SECRET,
  token: process.env.TUMBLR_TOKEN,
  token_secret: process.env.TUMBLR_TOKEN_SECRET
});

const imagePath = "C:\\Users\\luan\\Desktop\\SIT52E-COVER.png";

try {

  const response = await client.createPost("cyberisdead", {
    content: [
      {
        type: "image",
        media: fs.createReadStream(imagePath)
      }
    ]
  });

  console.log("Upload realizado!");
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

  const imageUrl = match[0];

  console.log("URL direta da capa:");
  console.log(imageUrl);

} catch (error) {

  console.error("Erro no upload:");
  console.error(error.response?.body || error.message);

}