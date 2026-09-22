import "dotenv/config";
import tumblr from "tumblr.js";

const client = tumblr.createClient({
  consumer_key: process.env.TUMBLR_CONSUMER_KEY,
  consumer_secret: process.env.TUMBLR_CONSUMER_SECRET,
  token: process.env.TUMBLR_TOKEN,
  token_secret: process.env.TUMBLR_TOKEN_SECRET
});

try {
  const response = await client.userInfo();

  console.log("Tumblr conectado com sucesso!");
  console.log("Usuário:", response.user.name);
} catch (error) {
  console.error("Erro ao conectar no Tumblr:");
  console.error(error.response?.body || error.message);
}