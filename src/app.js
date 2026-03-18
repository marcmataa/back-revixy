//Importaciones
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

//Configuraciones
dotenv.config()

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT||5001;

// API
app.get('/', (req, res)=>{
    res.send("Prueba conexion con app de Revixy");
});
app.listen(PORT,()=>{
    console.log(`Estas conectado correctamente al servidor http://localhost:${PORT}`)
});