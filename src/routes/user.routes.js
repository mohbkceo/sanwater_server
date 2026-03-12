
const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middlewares');

const {
  getUserData,
  registerUser,
  updateUser,
  findUser,
  deleteUser,
  SignAuth,
  logout,
  authenticateUser,
  createUserOrder
} = require('../controllers');


router.post('/register', registerUser);
router.post('/signin', SignAuth);
router.post('/authenticate', authenticateUser);

router.post('/create_draft_order', createUserOrder)

router.get('/user', getUserData);
router.get('/fun', authenticateToken, findUser);

router.put('/update/:username', authenticateToken, updateUser);
router.delete('/delete/:uid', authenticateToken, deleteUser);

router.post('/logout', logout);



module.exports = router;
