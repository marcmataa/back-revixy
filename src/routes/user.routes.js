import express from "express";
import { RegisterController, LoginController, ProfileController } from "../controllers/user.controller.js";
import {AppMiddleware} from '../middleware/app.middleware.js'
const UserRouter = express.Router();
//Creamos el post con la ruta register y los valores que tienen el registerController
UserRouter.post("/register", RegisterController);
UserRouter.post("/login", LoginController)
//Es importante ya que si pusieramos el middleware en login o register el usuario no podria entrar ya que el token no lo tendria ya que caduca al cabo de una hora, gracias a esto, podemos hacer que se sepa el rol... y ya poder añadir platos... si es admin o gestionar la reserva
UserRouter.get("/profile", AppMiddleware, ProfileController)

export default UserRouter;
