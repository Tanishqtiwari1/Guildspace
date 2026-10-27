"""FR1-FR3: registration, login, current user."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import models, database, schemas, services, trust_services
from auth import hash_password, verify_password, create_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", status_code=201)
def register(body: schemas.RegisterIn, db: Session = Depends(database.get_db)):
    email = body.email.lower()
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    # The first account on a fresh installation becomes the administrator.
    is_first = db.query(models.User).count() == 0
    user = models.User(
        name=body.name.strip(),
        email=email,
        password_hash=hash_password(body.password),
        role=body.role,
        location=body.location.strip() if body.location else None,
        preferred_mode=body.preferred_mode,
        account_type=body.account_type,
        is_admin=is_first,
    )
    db.add(user)
    db.flush()
    if body.account_type == "FACULTY":
        # Faculty must be verified by an administrator before they can reach students
        # (an administrator registering as faculty is trusted immediately).
        db.add(models.FacultyProfile(
            user_id=user.id, department=body.department.strip(),
            designation=(body.designation or "").strip() or None, employee_id=(body.employee_id or "").strip() or None,
            verified=is_first, verified_at=models.utcnow() if is_first else None,
        ))
        for admin in db.query(models.User).filter_by(is_admin=True, is_active=True):
            if admin.id != user.id:
                services.notify(db, admin.id, "SYSTEM", f"{user.name} ({body.department}) registered as faculty and needs verification.", "/admin")
        services.notify(db, user.id, "SYSTEM", "Welcome! Create your first course once an administrator verifies your faculty account.", "/")
    else:
        trust_services.ensure_starter(db, user.id)
        services.notify(db, user.id, "SYSTEM", f"Welcome! You have {trust_services.STARTER_CREDITS:g} starter credits. Add the skills you offer and need, then set your availability.", "/profile")
    db.commit()
    db.refresh(user)
    return {"token": create_token(user.id), "user": schemas.user_private(user)}


@router.post("/login")
def login(body: schemas.LoginIn, db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.email == body.email.lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="This account has been deactivated by an administrator")
    return {"token": create_token(user.id), "user": schemas.user_private(user)}


@router.get("/me")
def me(user: models.User = Depends(get_current_user)):
    return schemas.user_private(user)
