import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import models, database
from routers import auth, profile, matches, mentorship, communication, feedback, ai, admin, dashboard, faculty, academics, trust

logging.basicConfig(level=logging.INFO)
models.Base.metadata.create_all(bind=database.engine)
database.migrate()

app = FastAPI(title="Skill Exchange API", version="3.0")

# The React dev server runs on a different port; restrict CORS to known frontend origins.
origins = os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth, profile, matches, mentorship, communication, feedback, ai, admin, dashboard, faculty, academics, trust):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
