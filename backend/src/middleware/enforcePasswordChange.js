module.exports = function enforcePasswordChange(req, res, next) {
  if (req.user?.must_change_password) {
    return res.status(403).json({
      error: "PASSWORD_CHANGE_REQUIRED",
      message: "You must change your password before continuing.",
    });
  }

  next();
};
