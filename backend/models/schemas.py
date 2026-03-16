"""Pydantic models for API request/response and Firestore documents."""

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from config import (
    MAX_LEN_LONG,
    MAX_LEN_MEDIUM,
    MAX_LEN_SHORT,
    MAX_LEN_SVG,
    MAX_LEN_URL,
    MAX_LIST_ITEMS,
)


# --- Enums ---

class WorkbookStatus(str, Enum):
    DRAFT = "draft"
    LOCKED = "locked"


class WorkbookVisibility(str, Enum):
    PRIVATE = "private"          # 본인만 사용
    PUBLIC = "public"            # 누구나 열람 가능
    FOR_SALE = "for_sale"        # 판매용 (구매 전 잠김)
    PURCHASED = "purchased"      # 구매 완료
    COPIED = "copied"            # 가져온 교재 (변경 불가)


class AnswerType(str, Enum):
    INTEGER = "integer"
    FRACTION = "fraction"
    DECIMAL = "decimal"
    CHOICE = "choice"


class DifficultyBand(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class StudyStatus(str, Enum):
    CORRECT = "correct"          # 첫 시도 정답
    WRONG = "wrong"              # 오답 (코칭/확인 미완료)
    COACHED = "coached"          # 코칭 완료 (확인문제 미실시)
    MASTERED = "mastered"        # 오답 → 코칭 → 확인문제 정답
    DISPUTED = "disputed"        # 오채점 이의제기 (관리자 확인 대기)


class DisputeStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"        # 관리자가 정답 인정
    REJECTED = "rejected"        # 관리자가 오답 확정


# --- Workbook ---

class WorkbookCreate(BaseModel):
    label: str = Field(max_length=MAX_LEN_SHORT)
    visibility: WorkbookVisibility = WorkbookVisibility.PUBLIC


class WorkbookResponse(BaseModel):
    workbook_id: str
    label: str
    status: WorkbookStatus
    visibility: WorkbookVisibility = WorkbookVisibility.PUBLIC
    owner_uid: Optional[str] = None
    cover_photo_url: Optional[str] = None
    problem_count: int = 0
    answer_coverage: int = 0
    explanation_coverage: int = 0
    created_at: datetime
    locked_at: Optional[datetime] = None


class AssignStudentRequest(BaseModel):
    student_uid: str = Field(max_length=MAX_LEN_SHORT)


# --- Answer Key ---

class AnswerKeyEntry(BaseModel):
    page: int
    number: int
    final_answer: str = Field(max_length=MAX_LEN_SHORT)
    answer_type: AnswerType
    solution_steps: list[str] = Field(default_factory=list, max_length=MAX_LIST_ITEMS)
    pitfalls: list[str] = Field(default_factory=list, max_length=MAX_LIST_ITEMS)
    concept_tag: str = Field(max_length=MAX_LEN_SHORT)
    problem_type: str = Field(default="unknown", max_length=MAX_LEN_SHORT)
    variant_template_id: Optional[str] = Field(default=None, max_length=MAX_LEN_SHORT)
    extraction_confidence: float = 1.0
    manually_corrected: bool = False
    source_page_start: Optional[int] = None
    source_page_end: Optional[int] = None
    problem_description: Optional[str] = Field(default=None, max_length=MAX_LEN_LONG)
    diagram_svg: Optional[str] = Field(default=None, max_length=MAX_LEN_SVG)
    source_question_page_url: Optional[str] = Field(default=None, max_length=MAX_LEN_URL)
    image_dependent: bool = False
    problem_image_url: Optional[str] = Field(default=None, max_length=MAX_LEN_URL)
    review_enabled: bool = True
    verify_enabled: bool = True


# --- Grading ---

class GradeRequest(BaseModel):
    workbook_id: str = Field(max_length=MAX_LEN_SHORT)
    page: int
    number: int


class GradeResponse(BaseModel):
    attempt_id: str
    is_correct: bool
    student_answer: Optional[str] = None
    correct_answer: str
    concept_tag: str
    problem_type: Optional[str] = None
    error_tag: Optional[str] = None
    feedback: str
    problem_photo_url: Optional[str] = None
    work_photo_url: Optional[str] = None
    problem_description: Optional[str] = None


# --- Attempt ---

class AttemptRecord(BaseModel):
    attempt_id: str
    student_id: str
    workbook_id: str
    page: int
    number: int
    problem_photo_url: Optional[str] = None
    work_photo_url: str
    student_answer: Optional[str] = None
    correct_answer: str
    is_correct: bool
    error_tag: Optional[str] = None
    concept_tag: str
    problem_type: Optional[str] = None
    coaching_session_id: Optional[str] = None
    quality_score: int = 0
    created_at: datetime


# --- Mistake Card (SM-2) ---

class MistakeCard(BaseModel):
    card_id: str
    student_id: str
    concept_tag: str
    problem_type: Optional[str] = None
    difficulty_band: DifficultyBand
    template_id: str
    source_attempt_ids: list[str] = Field(default_factory=list)
    ease_factor: float = 2.5
    interval: int = 1
    repetitions: int = 0
    due_at: datetime
    last_reviewed_at: Optional[datetime] = None
    last_quality: int = 0
    created_at: datetime


class ReviewSubmit(BaseModel):
    card_id: str = Field(max_length=MAX_LEN_SHORT)
    is_correct: bool
    quality_score: int = Field(ge=0, le=5)


class ReviewResponse(BaseModel):
    card_id: str
    is_correct: bool
    next_due_at: datetime
    quality_score: int


# --- Scan ---

class ScanStartRequest(BaseModel):
    workbook_id: str = Field(max_length=MAX_LEN_SHORT)
    start_page_index: int = 1


class ScanStatusResponse(BaseModel):
    session_id: str
    status: str
    answers_found: int = 0
    explanations_found: int = 0
    problem_descriptions_found: int = 0
    warnings: list[str] = Field(default_factory=list)
    progress_message: str = ""
    progress_pct: int = 0


class WorkbookUpdate(BaseModel):
    label: Optional[str] = Field(default=None, max_length=MAX_LEN_SHORT)
    visibility: Optional[WorkbookVisibility] = None


class AnswerKeyEdit(BaseModel):
    final_answer: Optional[str] = Field(default=None, max_length=MAX_LEN_SHORT)
    answer_type: Optional[AnswerType] = None
    concept_tag: Optional[str] = Field(default=None, max_length=MAX_LEN_SHORT)
    problem_type: Optional[str] = Field(default=None, max_length=MAX_LEN_SHORT)
    solution_steps: Optional[list[str]] = Field(default=None, max_length=MAX_LIST_ITEMS)
    pitfalls: Optional[list[str]] = Field(default=None, max_length=MAX_LIST_ITEMS)
    source_page_start: Optional[int] = None
    source_page_end: Optional[int] = None
    problem_description: Optional[str] = Field(default=None, max_length=MAX_LEN_LONG)
    diagram_svg: Optional[str] = Field(default=None, max_length=MAX_LEN_SVG)
    image_dependent: Optional[bool] = None
    problem_image_url: Optional[str] = Field(default=None, max_length=MAX_LEN_URL)
    review_enabled: Optional[bool] = None
    verify_enabled: Optional[bool] = None


class AnswerKeyCreate(BaseModel):
    page: int
    number: int
    final_answer: str = Field(max_length=MAX_LEN_SHORT)
    problem_description: Optional[str] = Field(default=None, max_length=MAX_LEN_LONG)
    solution_steps: list[str] = Field(default_factory=list, max_length=MAX_LIST_ITEMS)
    pitfalls: list[str] = Field(default_factory=list, max_length=MAX_LIST_ITEMS)
    image_dependent: bool = False
    problem_image_url: Optional[str] = Field(default=None, max_length=MAX_LEN_URL)
    review_enabled: bool = True
    verify_enabled: bool = True


class MathConvertRequest(BaseModel):
    text: str = Field(max_length=MAX_LEN_MEDIUM)


# --- Variant ---

class VariantProblem(BaseModel):
    template_id: str
    concept_tag: str
    display_text: str
    correct_answer: str
    difficulty_band: DifficultyBand


class VariantGenerateResponse(BaseModel):
    display_text: str
    correct_answer: str
    difficulty_band: str = "medium"
    diagram_svg: Optional[str] = None


class VerifyGradeResponse(BaseModel):
    attempt_id: str
    is_correct: bool
    student_answer: Optional[str] = None
    correct_answer: str
    error_tag: Optional[str] = None
    feedback: str


# --- Study Record ---

class StudyRecord(BaseModel):
    record_id: str
    student_id: str
    workbook_id: str
    page: int
    number: int
    status: StudyStatus
    concept_tag: str
    problem_type: Optional[str] = None
    error_tag: Optional[str] = None
    attempt_ids: list[str] = Field(default_factory=list)
    mistake_card_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# --- User ---

class UserRole(str, Enum):
    ADMIN = "admin"
    STUDENT = "student"


class UserTier(str, Enum):
    FREE = "free"
    PREMIUM = "premium"


class UserRegisterRequest(BaseModel):
    role: UserRole
    admin_email: Optional[str] = Field(default=None, max_length=MAX_LEN_SHORT)


class UserProfile(BaseModel):
    uid: str
    email: str
    display_name: str
    photo_url: Optional[str] = None
    role: UserRole
    tier: UserTier = UserTier.FREE
    admin_email: Optional[str] = None
    admin_uid: Optional[str] = None
    approved: bool = True
    created_at: datetime
    updated_at: datetime


# --- Teacher-Student Links ---

class LinkStatus(str, Enum):
    ACTIVE = "active"
    REMOVED = "removed"


class JoinTeacherRequest(BaseModel):
    teacher_email: str = Field(max_length=MAX_LEN_SHORT)


class RemoveStudentRequest(BaseModel):
    student_uid: str = Field(max_length=MAX_LEN_SHORT)


class TeacherInfo(BaseModel):
    teacher_uid: str
    teacher_email: str
    teacher_display_name: str


class StudentInfo(BaseModel):
    student_uid: str
    student_email: str
    student_display_name: str
    photo_url: Optional[str] = None


class TeacherStudentLinkResponse(BaseModel):
    teacher_uid: str
    student_uid: str
    teacher_email: str
    teacher_display_name: str
    student_email: str
    student_display_name: str
    status: LinkStatus
    created_at: datetime


# --- Disputes (오채점) ---

class DisputeSource(str, Enum):
    SOLVE = "solve"
    VERIFY = "verify"
    REVIEW = "review"


class DisputeCreateRequest(BaseModel):
    attempt_id: str = Field(max_length=MAX_LEN_SHORT)
    workbook_id: str = Field(max_length=MAX_LEN_SHORT)
    page: int
    number: int
    student_answer: str = Field(max_length=MAX_LEN_SHORT)
    correct_answer: str = Field(max_length=MAX_LEN_SHORT)
    problem_description: str = Field(default="", max_length=MAX_LEN_LONG)
    source: DisputeSource = DisputeSource.SOLVE


class DisputeResponse(BaseModel):
    model_config = {"extra": "ignore"}

    dispute_id: str
    status: DisputeStatus
    student_id: str
    attempt_id: str = ""
    workbook_id: str
    page: int
    number: int
    student_answer: str
    correct_answer: str
    problem_description: str = ""
    source: str = "solve"
    workbook_label: Optional[str] = None
    created_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    admin_note: Optional[str] = None


class DisputeResolveRequest(BaseModel):
    accepted: bool
    admin_note: str = Field(default="", max_length=MAX_LEN_MEDIUM)


# --- Regen Requests (재출제 요청) ---

class RegenRequestStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"   # 관리자가 재출제 승인 (변형 재생성)
    REJECTED = "rejected"   # 관리자가 기각


class RegenRequestCreateRequest(BaseModel):
    card_id: str = Field(max_length=MAX_LEN_SHORT)
    workbook_id: str = Field(max_length=MAX_LEN_SHORT)
    page: int
    number: int
    variant_text: str = Field(max_length=MAX_LEN_MEDIUM)
    correct_answer: str = Field(max_length=MAX_LEN_SHORT)
    problem_description: str = Field(default="", max_length=MAX_LEN_LONG)


class RegenRequestResponse(BaseModel):
    model_config = {"extra": "ignore"}

    request_id: str
    status: RegenRequestStatus
    student_id: str
    card_id: str
    workbook_id: str
    workbook_label: Optional[str] = None
    page: int
    number: int
    variant_text: str
    correct_answer: str
    problem_description: str = ""
    created_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    admin_note: Optional[str] = None


class RegenResolveRequest(BaseModel):
    accepted: bool
    admin_note: str = Field(default="", max_length=MAX_LEN_MEDIUM)
