import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ─── Empresas (multitenancy) ──────────────────────────────────────────────
  companies: defineTable({
    name: v.string(),
    /** Slug único usado para identificar la empresa */
    slug: v.optional(v.string()),
    /** Email del administrador principal */
    adminEmail: v.string(),
    /** Plan contratado */
    planName: v.string(),
    /** Estado de la empresa */
    status: v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("suspended"),
      v.literal("trial"),
    ),
    /** Número máximo de usuarios incluidos en el plan */
    maxUsers: v.number(),
    /** Fecha de vencimiento del plan (ISO 8601) */
    expiresAt: v.optional(v.string()),
    /** Notas internas del Super Admin */
    notes: v.optional(v.string()),
    /** Logotipo URL */
    logoUrl: v.optional(v.string()),
    /** País de la empresa */
    country: v.optional(v.string()),
    /** Teléfono de contacto */
    phone: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
    /** Razón social / nombre legal */
    razonSocial: v.optional(v.string()),
    /** RUC / identificación tributaria */
    ruc: v.optional(v.string()),
    /** Dirección fiscal */
    direccion: v.optional(v.string()),
    /** Ciudad */
    ciudad: v.optional(v.string()),
    /** URL de banner corporativo */
    bannerUrl: v.optional(v.string()),
    /** Sitio web de la empresa */
    website: v.optional(v.string()),
    /** Descripción de la empresa */
    description: v.optional(v.string()),
  }).index("by_adminEmail", ["adminEmail"])
    .index("by_status", ["status"]),

  /** Invitaciones para que los usuarios se unan a una empresa */
  companyInvitations: defineTable({
    companyId: v.id("companies"),
    /** Email del usuario invitado */
    email: v.string(),
    /** Nombre del invitado (para pre-rellenar) */
    inviteeName: v.optional(v.string()),
    /** Apellidos del invitado */
    inviteeLastName: v.optional(v.string()),
    /** Rol asignado al aceptar la invitación */
    role: v.union(
      v.literal("company_admin"),
      v.literal("medical_user"),
      v.literal("tecnico"),
      v.literal("recepcion"),
      v.literal("consulta"),
    ),
    /** Código profesional pre-asignado */
    professionalCode: v.optional(v.string()),
    /** Estado de la invitación */
    status: v.union(
      v.literal("pending"),   // esperando que el usuario haga login
      v.literal("accepted"),  // usuario aceptó (hizo login)
      v.literal("cancelled"), // cancelada por el admin
    ),
    /** Quién creó la invitación (tokenIdentifier del admin) */
    createdBy: v.string(),
    createdAt: v.string(),
    /** Cuándo fue aceptada */
    acceptedAt: v.optional(v.string()),
  }).index("by_company", ["companyId"])
    .index("by_email", ["email"])
    .index("by_email_and_status", ["email", "status"]),

  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    country: v.optional(v.string()),
    isEmailVerified: v.optional(v.boolean()),
    // ── Campos multiempresa ──────────────────────────────────────────────────
    /** ID de la empresa a la que pertenece el usuario (null = usuario independiente) */
    companyId: v.optional(v.id("companies")),
    /** Rol del usuario dentro de AFG MedView */
    role: v.optional(v.union(
      v.literal("company_admin"),   // Administrador de empresa
      v.literal("medical_user"),    // Usuario médico de empresa
      v.literal("tecnico"),         // Técnico DICOM
      v.literal("recepcion"),       // Recepción / administrativo
      v.literal("consulta"),        // Solo consulta de información
      v.literal("independent"),     // Usuario independiente (plan individual)
    )),
    /** Estado del usuario dentro de la empresa */
    companyStatus: v.optional(v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("pending"),         // invitado pero no ha hecho login aún
    )),
    /** Código profesional / número de registro médico */
    professionalCode: v.optional(v.string()),
  }).index("by_token", ["tokenIdentifier"])
    .index("by_company", ["companyId"]),

  subscriptions: defineTable({
    userId: v.id("users"),
    status: v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("expired"),
      v.literal("pending")
    ),
    planName: v.string(),
    priceUsd: v.number(),
    startDate: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
    paymentReference: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  billingData: defineTable({
    userId: v.id("users"),
    nombres: v.optional(v.string()),
    apellidos: v.optional(v.string()),
    razonSocial: v.string(),
    identificacion: v.string(),
    ruc: v.optional(v.string()),
    emailFactura: v.string(),
    telefono: v.optional(v.string()),
    direccion: v.string(),
    ciudad: v.string(),
    provinciaEstado: v.string(),
    pais: v.string(),
  }).index("by_user", ["userId"]),

  settings: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),

  plans: defineTable({
    planId: v.string(),
    name: v.string(),
    badge: v.string(),
    badgeStyle: v.string(),
    price: v.string(),
    priceDetail: v.string(),
    promoPrice: v.optional(v.string()),
    paymentMethod: v.string(),
    description: v.string(),
    features: v.array(v.string()),
    notIncluded: v.optional(v.array(v.string())),
    footnote: v.optional(v.string()),
    distinctive: v.optional(v.string()),
    ctaLanding: v.string(),
    ctaPlanes: v.string(),
    ctaPago: v.string(),
    darkCardStyle: v.string(),
    darkHeaderStyle: v.string(),
    darkBtnStyle: v.string(),
    isActive: v.boolean(),
    sortOrder: v.number(),
    /** Precio de implementación (solo plan empresa) */
    implementationPrice: v.optional(v.string()),
    /** Precio mensual (solo plan empresa) */
    monthlyPrice: v.optional(v.string()),
    /** Máx usuarios permitidos (0 = ilimitado/configurable) */
    maxUsers: v.optional(v.number()),
    /** Máx estudios por mes (0 = ilimitado) */
    maxStudies: v.optional(v.number()),
    /** Almacenamiento incluido en GB (0 = ilimitado) */
    storageGb: v.optional(v.number()),
    /** Modalidad de pago: "monthly" | "once" | "free" | "enterprise" */
    paymentMode: v.optional(v.string()),
    /** Tipo de plan para lógica: "individual" | "enterprise" */
    planType: v.optional(v.string()),
  }).index("by_planId", ["planId"])
    .index("by_sortOrder", ["sortOrder"]),

  /** Solicitudes de implementación del plan Empresa desde la landing */
  enterpriseRequests: defineTable({
    companyName: v.string(),
    contactName: v.string(),
    contactEmail: v.string(),
    phone: v.optional(v.string()),
    estimatedUsers: v.optional(v.number()),
    estimatedStudies: v.optional(v.string()),
    city: v.optional(v.string()),
    country: v.optional(v.string()),
    observations: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("reviewing"),
      v.literal("contacted"),
      v.literal("closed"),
    ),
    createdAt: v.string(),
    /** Notas internas del Super Admin */
    adminNotes: v.optional(v.string()),
    updatedAt: v.optional(v.string()),
  }).index("by_status", ["status"])
    .index("by_created_at", ["createdAt"]),

  /** Configuración PACS por empresa (aislado por companyId) */
  companyPacsConfig: defineTable({
    companyId: v.id("companies"),
    pacsName: v.optional(v.string()),
    /** URL o IP del servidor Orthanc */
    orthancHost: v.optional(v.string()),
    orthancPort: v.optional(v.string()),
    /** URL REST Orthanc (ej. http://host:8042) */
    orthancUrl: v.optional(v.string()),
    /** URL DICOMweb (ej. http://host:8042/dicom-web) */
    dicomWebUrl: v.optional(v.string()),
    /** AE Title del PACS */
    aeTitle: v.optional(v.string()),
    /** Usuario de autenticación Orthanc */
    username: v.optional(v.string()),
    /** Contraseña almacenada cifrada — NUNCA se retorna completa */
    password: v.optional(v.string()),
    /** API Key Orthanc (si aplica) */
    apiKey: v.optional(v.string()),
    /** Usar HTTPS */
    useHttps: v.optional(v.boolean()),
    /** Habilitar carpeta DICOM local como alternativa */
    localFolderEnabled: v.optional(v.boolean()),
    /** Estado de la configuración */
    status: v.union(
      v.literal("pending"),    // aún no configurado
      v.literal("active"),     // configurado y funcionando
      v.literal("error"),      // error de conexión
      v.literal("disabled"),   // desactivado manualmente
    ),
    /** Estado de la última prueba de conexión */
    lastConnectionStatus: v.optional(v.string()),
    /** Fecha de la última prueba (ISO 8601) */
    lastTestedAt: v.optional(v.string()),
    updatedAt: v.string(),
  }).index("by_company", ["companyId"]),

  adminSessions: defineTable({
    token: v.string(),
    createdAt: v.string(),
  }).index("by_token", ["token"]),

  /** Códigos OTP para verificación de acceso al admin */
  adminOtpCodes: defineTable({
    code: v.string(),
    createdAt: v.string(),
    expiresAt: v.string(),
    used: v.boolean(),
  }).index("by_code", ["code"]),

  /** Auditoría de accesos al panel administrativo */
  adminAccessLog: defineTable({
    attemptedAt: v.string(),
    username: v.string(),
    result: v.union(v.literal("success"), v.literal("failed_credentials"), v.literal("failed_otp")),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  }).index("by_attempted_at", ["attemptedAt"]),

  /** Datos bancarios / pago para el QR de activación (editables desde back office) */
  paymentInfo: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),

  /** Comprobantes de pago subidos por usuarios */
  paymentVouchers: defineTable({
    userId: v.id("users"),
    planType: v.string(),
    storageId: v.string(),
    fileName: v.string(),
    fileType: v.string(),
    uploadedAt: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    invoiceNumber: v.optional(v.string()),
    invoiceIssuedAt: v.optional(v.string()),
    invoiceStatus: v.optional(v.union(v.literal("pending"), v.literal("issued"), v.literal("not_required"))),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"]).index("by_status", ["status"]),

  termsAcceptances: defineTable({
    userId: v.optional(v.id("users")),
    tokenIdentifier: v.optional(v.string()),
    acceptedAt: v.string(),
    version: v.string(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_user", ["userId"]),

  // ─── Módulo MEDVIEW AI REPORT ─────────────────────────────────────────────
  /** Informes radiológicos generados/editados por el médico */
  aiReports: defineTable({
    userId: v.id("users"),
    title: v.string(),
    studyInstanceUid: v.optional(v.string()),
    patientName: v.string(),
    patientId: v.optional(v.string()),
    patientAge: v.optional(v.string()),
    patientSex: v.optional(v.string()),
    studyDate: v.optional(v.string()),
    modality: v.optional(v.string()),
    anatomicRegion: v.optional(v.string()),
    clinicalHistory: v.optional(v.string()),
    indication: v.string(),
    technique: v.string(),
    findings: v.string(),
    impression: v.string(),
    recommendations: v.optional(v.string()),
    reportCode: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
    templateId: v.optional(v.id("aiReportTemplates")),
    status: v.union(v.literal("draft"), v.literal("final")),
    /** Empresa a la que pertenece el informe (para aislamiento multiempresa) */
    companyId: v.optional(v.id("companies")),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_status", ["userId", "status"])
    .index("by_created_at", ["createdAt"])
    .index("by_company", ["companyId"]),

  /** Plantillas de informes por usuario */
  aiReportTemplates: defineTable({
    userId: v.id("users"),
    name: v.string(),
    modality: v.optional(v.string()),
    indication: v.optional(v.string()),
    technique: v.optional(v.string()),
    findings: v.optional(v.string()),
    impression: v.optional(v.string()),
    recommendations: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_user", ["userId"]),

  /** Perfil médico del usuario (para el encabezado del informe) */
  doctorProfile: defineTable({
    userId: v.id("users"),
    doctorName: v.string(),
    specialty: v.optional(v.string()),
    registration: v.optional(v.string()),
    medicalCenter: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    country: v.optional(v.string()),
    reportFooter: v.optional(v.string()),
    /** Storage ID del logo (Convex File Storage) */
    logoStorageId: v.optional(v.string()),
    /** Storage ID de la firma digital (Convex File Storage) */
    signatureStorageId: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  // ─── Sistema Comercial (independiente de subscriptions) ──────────────────
  licenses: defineTable({
    userId: v.id("users"),
    planType: v.union(
      v.literal("trial"),
      v.literal("personal"),
      v.literal("premium"),
      v.literal("pro"),
      v.literal("paciente"),
      v.literal("empresa")
    ),
    status: v.union(
      v.literal("trial"),
      v.literal("active"),
      v.literal("expired"),
      v.literal("pending"),
      v.literal("suspended"),
      v.literal("pending_payment"),
      v.literal("revoked"),
      v.literal("finished")
    ),
    priceUsd: v.number(),
    startDate: v.string(),
    /** Solo para trial: fecha de vencimiento */
    expiryDate: v.optional(v.string()),
    /** Fecha hasta la que incluye actualizaciones (legacy — no se usa en nuevas licencias) */
    updatesExpiryDate: v.optional(v.string()),
    /** Cantidad de equipos autorizados */
    maxDevices: v.optional(v.number()),
    /** Estudios procesados (trial) */
    studiesUsed: v.optional(v.number()),
    /** Máx estudios permitidos (trial) */
    maxStudies: v.optional(v.number()),
    paymentReference: v.optional(v.string()),
    activatedAt: v.optional(v.string()),
    notes: v.optional(v.string()),
    /** Código único de licencia (auto-generado al activar) */
    licenseCode: v.optional(v.string()),
    // Datos médicos (Pro)
    doctorName: v.optional(v.string()),
    doctorSpecialty: v.optional(v.string()),
    doctorEmail: v.optional(v.string()),
    doctorCountry: v.optional(v.string()),
    doctorCity: v.optional(v.string()),
    doctorRegistration: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_planType", ["planType"])
    .index("by_licenseCode", ["licenseCode"]),

  /** Historial de activaciones de licencias */
  licenseActivations: defineTable({
    licenseId: v.id("licenses"),
    userId: v.id("users"),
    activatedAt: v.string(),
    activatedBy: v.string(), // "admin" o tokenIdentifier
    planType: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_license", ["licenseId"])
    .index("by_user", ["userId"]),

  /** Auditoría de cambios de plan/estado por el administrador */
  licenseAudit: defineTable({
    licenseId: v.id("licenses"),
    userId: v.id("users"),
    changedAt: v.string(),
    changedBy: v.string(), // "admin" o tokenIdentifier
    previousPlan: v.string(),
    newPlan: v.string(),
    previousStatus: v.string(),
    newStatus: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_license", ["licenseId"])
    .index("by_user", ["userId"])
    .index("by_changed_at", ["changedAt"]),

  licenseRequests: defineTable({
    userId: v.id("users"),
    planType: v.union(v.literal("personal"), v.literal("premium"), v.literal("pro"), v.literal("paciente"), v.literal("personalizado")),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    requestedAt: v.string(),
    // Datos de contacto / médicos
    doctorName: v.optional(v.string()),
    doctorSpecialty: v.optional(v.string()),
    doctorEmail: v.optional(v.string()),
    doctorCountry: v.optional(v.string()),
    doctorCity: v.optional(v.string()),
    doctorRegistration: v.optional(v.string()),
    paymentReference: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Plan personalizado
    customModules: v.optional(v.string()),
    customMonthlyTotal: v.optional(v.number()),
    customAnnualTotal: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"]),

  contactMessages: defineTable({
    nombre: v.string(),
    email: v.string(),
    pais: v.string(),
    asunto: v.string(),
    mensaje: v.string(),
    creadoEn: v.string(),
    leido: v.boolean(),
  }).index("by_leido", ["leido"]),

  // ─── Configuración de atajos de teclado/mouse por usuario ────────────────
  shortcutProfiles: defineTable({
    userId: v.id("users"),
    profileName: v.string(),
    profileType: v.union(
      v.literal("general"),
      v.literal("radiologia"),
      v.literal("mamografia"),
      v.literal("ecografia"),
      v.literal("tomografia"),
      v.literal("resonancia"),
      v.literal("personalizado")
    ),
    /** JSON stringified ShortcutMap */
    shortcuts: v.string(),
    isActive: v.boolean(),
    updatedAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_active", ["userId", "isActive"]),

  // ─── Presets personalizados de Window/Level por usuario ─────────────────
  windowPresets: defineTable({
    userId: v.id("users"),
    label: v.string(),
    wc: v.number(),
    ww: v.number(),
    /** Orden de visualización */
    sortOrder: v.number(),
    createdAt: v.string(),
  }).index("by_user", ["userId"]),

  // ─── Preferencias de interfaz del visor por usuario ─────────────────────
  viewerPreferences: defineTable({
    userId: v.id("users"),
    /** Tamaño de iconos del panel lateral: "sm" | "md" | "lg" */
    iconSize: v.optional(v.union(v.literal("sm"), v.literal("md"), v.literal("lg"))),
    /** Mostrar nombres debajo de los iconos */
    showLabels: v.optional(v.boolean()),
    /** Panel lateral expandido por defecto */
    panelExpanded: v.optional(v.boolean()),
    /** Posición del editor de informes: "bottom" | "right" */
    editorPosition: v.optional(v.union(v.literal("bottom"), v.literal("right"))),
    /** Altura del editor (px) cuando está en modo acoplado inferior */
    editorHeight: v.optional(v.number()),
    /** Tema de color del visor: "dark" | "darker" | "slate" */
    colorTheme: v.optional(v.union(v.literal("dark"), v.literal("darker"), v.literal("slate"))),
    /** Mostrar barra de series (strip inferior) */
    showSeriesStrip: v.optional(v.boolean()),
    /** Mostrar panel inferior de datos (metadatos / informe) */
    showBottomPanel: v.optional(v.boolean()),
    updatedAt: v.string(),
  }).index("by_user", ["userId"]),

  // ─── Auditoría de exportaciones con marca de agua ────────────────────────
  exportAudit: defineTable({
    userId: v.id("users"),
    userName: v.optional(v.string()),
    userEmail: v.optional(v.string()),
    exportedAt: v.string(),
    fileType: v.string(),
    patientName: v.string(),
    patientId: v.string(),
    studyDate: v.string(),
    studyDescription: v.string(),
    institution: v.string(),
    watermarkConfigSnapshot: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_exported_at", ["exportedAt"]),

  // ─── Configuración de IA por usuario ─────────────────────────────────────
  aiConfig: defineTable({
    userId: v.id("users"),
    /** Proveedor activo */
    provider: v.union(
      v.literal("openai"),
      v.literal("gemini"),
      v.literal("claude"),
      v.literal("openrouter"),
      v.literal("azure"),
      v.literal("ollama")
    ),
    /** API Key cifrada (base64 de XOR con salt) — NUNCA se devuelve completa */
    encryptedKey: v.optional(v.string()),
    /** Últimos 4 caracteres de la key original (para enmascaramiento visual) */
    keyLast4: v.optional(v.string()),
    /** Modelo seleccionado */
    model: v.string(),
    /** Temperatura (0-2) — solo OpenAI/OpenRouter */
    temperature: v.optional(v.number()),
    /** Max tokens — solo OpenAI/OpenRouter */
    maxTokens: v.optional(v.number()),
    /** Azure: endpoint URL */
    azureEndpoint: v.optional(v.string()),
    /** Azure: deployment name */
    azureDeployment: v.optional(v.string()),
    /** Azure: API version */
    azureApiVersion: v.optional(v.string()),
    /** Ollama: IP/hostname */
    ollamaHost: v.optional(v.string()),
    /** Ollama: puerto */
    ollamaPort: v.optional(v.number()),
    /** Estado de la última prueba de conexión */
    connectionStatus: v.optional(v.union(
      v.literal("connected"),
      v.literal("error"),
      v.literal("untested")
    )),
    /** Fecha de la última prueba de conexión (ISO 8601) */
    lastTestedAt: v.optional(v.string()),
    /** Mensaje de error de la última prueba */
    lastErrorMessage: v.optional(v.string()),
    updatedAt: v.string(),
  }).index("by_user", ["userId"]),

  /** Logs de uso de IA (cada solicitud a proveedor) */
  aiUsageLogs: defineTable({
    userId: v.id("users"),
    provider: v.string(),
    model: v.string(),
    /** Fecha/hora de la solicitud (ISO 8601 UTC) */
    requestedAt: v.string(),
    /** Tiempo de respuesta en ms */
    responseTimeMs: v.optional(v.number()),
    /** Estado de la solicitud */
    status: v.union(v.literal("success"), v.literal("error")),
    /** Tipo de error si hubo */
    errorType: v.optional(v.string()),
    /** Mensaje de error */
    errorMessage: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_requested_at", ["requestedAt"]),

  // ─── Registro de errores del frontend ────────────────────────────────────
  /** Errores capturados por ErrorBoundary o lógica de recuperación */
  errorLogs: defineTable({
    /** ISO 8601 UTC */
    occurredAt: v.string(),
    /** Identificador del usuario (tokenIdentifier) — opcional si no autenticado */
    tokenIdentifier: v.optional(v.string()),
    /** Nombre del usuario */
    userName: v.optional(v.string()),
    /** Email del usuario */
    userEmail: v.optional(v.string()),
    /** Ruta/página donde ocurrió el error */
    page: v.string(),
    /** Nombre del componente */
    component: v.optional(v.string()),
    /** Mensaje del error */
    errorMessage: v.string(),
    /** Stack trace */
    errorStack: v.optional(v.string()),
    /** Navigator.userAgent */
    userAgent: v.optional(v.string()),
    /** Plataforma: desktop / mobile / tablet */
    deviceType: v.optional(v.string()),
    /** Nombre del navegador */
    browser: v.optional(v.string()),
    /** ¿Fue reportado manualmente por el usuario? */
    reportedByUser: v.optional(v.boolean()),
  })
    .index("by_occurred_at", ["occurredAt"])
    .index("by_token", ["tokenIdentifier"]),

  // ─── Auditoría PRO: historial de sesión de visor por usuario ─────────────
  proAudit: defineTable({
    userId: v.id("users"),
    /** ID de sesión de visor (generado en el frontend al cargar un estudio) */
    sessionId: v.string(),
    /** Tipo de evento */
    eventType: v.union(
      v.literal("study_opened"),
      v.literal("meta_edited"),
      v.literal("measurement_added"),
      v.literal("measurement_cleared"),
      v.literal("roi_added"),
      v.literal("roi_cleared"),
      v.literal("annotation_added"),
      v.literal("annotation_cleared"),
      v.literal("export_pro"),
      v.literal("export_report"),
      v.literal("compare_opened"),
    ),
    /** ISO 8601 UTC */
    occurredAt: v.string(),
    /** Datos extra según el tipo (JSON stringificado) */
    payload: v.optional(v.string()),
    /** Info del estudio en el momento del evento */
    studyInfo: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_session", ["sessionId"])
    .index("by_occurred_at", ["occurredAt"]),

  // ─── Módulo INFORMAR — Recepción DICOM + Informe Manual ──────────────────

  /**
   * Worklist: estudios DICOM recibidos / pendientes de informar.
   * Deduplicados por studyInstanceUid.
   */
  worklistStudies: defineTable({
    /** ID del usuario dueño del estudio */
    userId: v.id("users"),
    /** DICOM Study Instance UID — clave de deduplicación */
    studyInstanceUid: v.string(),
    /** Nombre del paciente */
    patientName: v.string(),
    /** Patient ID */
    patientId: v.string(),
    /** Fecha del estudio (YYYYMMDD o YYYY-MM-DD) */
    studyDate: v.string(),
    /** Modalidad principal (CT, MR, CR, etc.) */
    modality: v.string(),
    /** Descripción del estudio */
    studyDescription: v.string(),
    /** Institución */
    institution: v.string(),
    /** Número de acceso */
    accessionNumber: v.string(),
    /** Número de series */
    seriesCount: v.number(),
    /** Número total de imágenes */
    imageCount: v.number(),
    /** Médico remitente */
    referringPhysician: v.optional(v.string()),
    /** Estado del estudio en la bandeja */
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("reported"),
      v.literal("archived")
    ),
    /** Médico asignado / que está informando */
    assignedDoctor: v.optional(v.string()),
    /** Fecha de recepción en AFG MedView (ISO 8601) */
    receivedAt: v.string(),
    /** Fecha de última actualización de estado (ISO 8601) */
    updatedAt: v.string(),
    /** Hora del estudio (HHMMSS.fraction) */
    studyTime: v.optional(v.string()),
    /** Nombre del archivo ZIP o carpeta original (para referencia) */
    sourceLabel: v.optional(v.string()),
    /** Fuente: "upload" | "local_folder" | "orthanc" */
    sourceType: v.optional(v.string()),
    /** Notas internas */
    notes: v.optional(v.string()),
    /** Storage ID del ZIP DICOM (Convex File Storage, opcional) */
    storageId: v.optional(v.string()),
    /** Empresa a la que pertenece el estudio (aislamiento multiempresa) */
    companyId: v.optional(v.id("companies")),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_status", ["userId", "status"])
    .index("by_uid", ["studyInstanceUid"])
    .index("by_received_at", ["receivedAt"])
    .index("by_company", ["companyId"]),

  /**
   * Informes manuales (sin IA) asociados a un worklistStudy.
   */
  manualReports: defineTable({
    /** Usuario autor del informe */
    userId: v.id("users"),
    /** Referencia al estudio en la bandeja */
    studyId: v.id("worklistStudies"),
    /** DICOM Study Instance UID (desnormalizado para búsquedas rápidas) */
    studyInstanceUid: v.string(),
    /** Datos del paciente (snapshot en el momento del informe) */
    patientName: v.string(),
    patientId: v.string(),
    modality: v.string(),
    studyDate: v.string(),
    studyDescription: v.string(),
    /** Código único del informe (ej. MR-20250101-001) */
    reportCode: v.string(),
    /** Secciones del informe (HTML de TipTap) */
    indication: v.string(),
    technique: v.string(),
    findings: v.string(),
    conclusion: v.string(),
    recommendations: v.string(),
    /** Estado del informe */
    status: v.union(v.literal("draft"), v.literal("final")),
    /** Médico informante (nombre visible) */
    doctorName: v.optional(v.string()),
    /** Registro profesional */
    doctorRegistration: v.optional(v.string()),
    /** Especialidad */
    doctorSpecialty: v.optional(v.string()),
    /** Plantilla usada (nombre) */
    templateName: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
    /** Fecha de finalización */
    finalizedAt: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_study", ["studyId"])
    .index("by_uid", ["studyInstanceUid"])
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"]),

  /**
   * Plantillas de informe manual personalizadas por usuario.
   * Separadas de las plantillas IA.
   */
  manualReportTemplates: defineTable({
    userId: v.id("users"),
    name: v.string(),
    modality: v.optional(v.string()),
    indication: v.optional(v.string()),
    technique: v.optional(v.string()),
    findings: v.optional(v.string()),
    conclusion: v.optional(v.string()),
    recommendations: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index("by_user", ["userId"]),

  // ─── PACS Piloto ─────────────────────────────────────────────────────────
  /** Auditoría básica de acciones PACS: consultar/abrir/visualizar estudio */
  pacsAuditLog: defineTable({
    /** ISO 8601 UTC */
    occurredAt: v.string(),
    /** tokenIdentifier del usuario (null si no autenticado) */
    tokenIdentifier: v.optional(v.string()),
    /** Nombre visible */
    userName: v.optional(v.string()),
    /** Acción realizada */
    action: v.union(
      v.literal("consulted_study"),
      v.literal("opened_study"),
      v.literal("viewed_study"),
      v.literal("connectivity_test"),
    ),
    /** StudyInstanceUID del estudio afectado */
    studyInstanceUid: v.optional(v.string()),
    /** Datos extra (JSON stringificado): modalidad, patient name, etc. */
    details: v.optional(v.string()),
  })
    .index("by_occurred_at", ["occurredAt"])
    .index("by_token", ["tokenIdentifier"]),

  /**
   * Configuración de fuente de estudios por usuario.
   * Almacena la fuente activa (Orthanc vs. Carpeta local) y parámetros.
   */
  worklistConfig: defineTable({
    userId: v.id("users"),
    /** "orthanc" | "local_folder" */
    activeSource: v.string(),
    /** Nombre/ruta de la carpeta local (solo referencia visual, la selección real es en el cliente) */
    localFolderPath: v.optional(v.string()),
    /** Fecha del último escaneo (ISO 8601) */
    lastScannedAt: v.optional(v.string()),
    /** Número de estudios encontrados en el último escaneo */
    lastScanCount: v.optional(v.number()),
    updatedAt: v.string(),
  }).index("by_user", ["userId"]),

  /**
   * Configuración PACS guardada por usuario administrador.
   * Incluye todos los parámetros de conexión a Orthanc/DICOMweb y carpeta local.
   */
  pacsConfig: defineTable({
    userId: v.id("users"),
    pacsName: v.optional(v.string()),
    localFolderPath: v.optional(v.string()),
    orthancHost: v.optional(v.string()),
    orthancPort: v.optional(v.string()),
    orthancUrl: v.optional(v.string()),
    dicomWebUrl: v.optional(v.string()),
    aeTitle: v.optional(v.string()),
    modalityIp: v.optional(v.string()),
    dicomPort: v.optional(v.string()),
    apiKey: v.optional(v.string()),
    username: v.optional(v.string()),
    password: v.optional(v.string()),
    useHttps: v.optional(v.boolean()),
    updatedAt: v.string(),
  }).index("by_user", ["userId"]),

  /** Historial de cambios de cuenta — plan, estado, tipo */
  accountHistory: defineTable({
    userId: v.id("users"),
    /** Quién realizó el cambio (siempre "Super Admin" para cambios del BO) */
    changedBy: v.string(),
    /** Timestamp ISO 8601 */
    changedAt: v.string(),
    /** Tipo de cambio */
    action: v.union(
      v.literal("plan_changed"),
      v.literal("suspended"),
      v.literal("activated"),
      v.literal("converted_to_enterprise"),
      v.literal("converted_to_individual"),
      v.literal("plan_assigned"),
    ),
    /** Valores anteriores */
    previousPlan: v.optional(v.string()),
    previousStatus: v.optional(v.string()),
    previousType: v.optional(v.string()),
    /** Valores nuevos */
    newPlan: v.optional(v.string()),
    newStatus: v.optional(v.string()),
    newType: v.optional(v.string()),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"])
    .index("by_changed_at", ["changedAt"]),

  // ─── Sistema de Permisos Centralizado ───────────────────────────────────────

  /**
   * Permisos base por plan.
   * El back office puede editar estas listas sin cambios de código.
   * Si no existe registro para un plan, se usan defaults hardcoded en convex/permissions.ts.
   */
  planPermissions: defineTable({
    /** Identificador del plan (ej. "trial", "life", "medico", "empresa") */
    planId: v.string(),
    /** Claves de permisos otorgadas por este plan (ej. ["viewer.measure", "reports.create"]) */
    permissionKeys: v.array(v.string()),
    /** ISO 8601 */
    updatedAt: v.string(),
  }).index("by_planId", ["planId"]),

  /**
   * Add-ons de usuario.
   * Un add-on concede claves de permiso adicionales independientemente del plan.
   * Ejemplo: "orthanc_connect" agrega ["pacs.connect", "pacs.worklist"]
   */
  userAddOns: defineTable({
    userId: v.id("users"),
    /** Identificador del add-on (ej. "orthanc_connect", "mpr_advanced") */
    addOnId: v.string(),
    /** Claves de permisos concedidas por este add-on */
    permissionKeys: v.array(v.string()),
    /** ISO 8601 cuando fue activado */
    activatedAt: v.string(),
    /** ISO 8601 cuando expira (undefined = nunca) */
    expiresAt: v.optional(v.string()),
    /** Si el add-on está activo */
    active: v.boolean(),
  }).index("by_user", ["userId"])
    .index("by_user_and_addon", ["userId", "addOnId"]),

  /**
   * Overrides de permiso por usuario.
   * El admin puede conceder (true) o denegar (false) cualquier clave a un usuario.
   * Tienen prioridad sobre plan base + add-ons.
   */
  userPermissionOverrides: defineTable({
    userId: v.id("users"),
    /** Clave de permiso a sobreescribir */
    permissionKey: v.string(),
    /** true = conceder, false = denegar */
    granted: v.boolean(),
    /** tokenIdentifier del admin que aplicó el override */
    setBy: v.string(),
    /** ISO 8601 */
    updatedAt: v.string(),
  }).index("by_user", ["userId"])
    .index("by_user_and_key", ["userId", "permissionKey"]),

  // ─── Equipos DICOM por empresa ──────────────────────────────────────────────
  /**
   * Equipos médicos registrados por una empresa (CT, MR, US, etc.)
   * Aislados por companyId.
   */
  dicomEquipment: defineTable({
    companyId: v.id("companies"),
    /** Nombre descriptivo del equipo (ej. "TOMÓGRAFO 01") */
    name: v.string(),
    /** Modalidad DICOM: CT, MR, US, CR, DR, MG, XA, NM, PET, OT */
    modality: v.string(),
    /** AE Title del equipo */
    aeTitle: v.optional(v.string()),
    /** IP o hostname */
    ip: v.optional(v.string()),
    /** Puerto DICOM (default 104) */
    port: v.optional(v.string()),
    /** Institución / sede */
    institution: v.optional(v.string()),
    /** Ubicación física */
    location: v.optional(v.string()),
    /** Fabricante */
    manufacturer: v.optional(v.string()),
    /** Modelo del equipo */
    model: v.optional(v.string()),
    /** Estado manual: "active" | "inactive" | "maintenance" */
    status: v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("maintenance"),
    ),
    /** Estado de conectividad DICOM (actualizado al probar conexión) */
    connectionStatus: v.optional(v.union(
      v.literal("connected"),
      v.literal("unreachable"),
      v.literal("untested"),
      v.literal("error"),
    )),
    /** Fecha de la última comunicación detectada (ISO 8601) */
    lastCommunicationAt: v.optional(v.string()),
    /** Fecha del último estudio recibido desde este equipo (ISO 8601) */
    lastStudyReceivedAt: v.optional(v.string()),
    /** Cantidad total de estudios recibidos desde este equipo */
    studiesReceived: v.optional(v.number()),
    /** Último mensaje de error de conectividad */
    lastErrorMessage: v.optional(v.string()),
    /** Fecha de la última prueba de conexión (ISO 8601) */
    lastTestedAt: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index("by_company", ["companyId"])
    .index("by_company_and_status", ["companyId", "status"]),

  // ─── Auditoría empresarial ───────────────────────────────────────────────────
  /**
   * Registro de acciones realizadas dentro del espacio empresarial.
   * Aislado por companyId.
   */
  companyAuditLog: defineTable({
    companyId: v.id("companies"),
    /** tokenIdentifier del usuario que realizó la acción */
    tokenIdentifier: v.optional(v.string()),
    /** Nombre visible del usuario */
    userName: v.optional(v.string()),
    /** Tipo de acción */
    action: v.string(),
    /** Detalle legible de la acción */
    detail: v.optional(v.string()),
    /** StudyInstanceUID relacionado */
    studyUid: v.optional(v.string()),
    /** Nombre del paciente relacionado */
    patientName: v.optional(v.string()),
    /** Nombre del equipo relacionado */
    equipmentName: v.optional(v.string()),
    /** IP del cliente cuando aplica */
    ipAddress: v.optional(v.string()),
    /** Resultado de la acción */
    result: v.optional(v.union(v.literal("success"), v.literal("error"), v.literal("info"))),
    occurredAt: v.string(),
  }).index("by_company", ["companyId"])
    .index("by_company_and_occurred_at", ["companyId", "occurredAt"]),

  // ─── Asignaciones de estudios a médicos ──────────────────────────────────────
  /**
   * Asignaciones de estudios DICOM a médicos para informar.
   * Aislado por companyId.
   */
  studyAssignments: defineTable({
    companyId: v.id("companies"),
    /** Estudio asignado (opcional: puede crearse sin estudio asociado aún) */
    studyId: v.optional(v.id("worklistStudies")),
    /** DICOM Study Instance UID (desnormalizado) */
    studyInstanceUid: v.optional(v.string()),
    /** Nombre del paciente (desnormalizado) */
    patientName: v.optional(v.string()),
    /** Médico al que se asigna */
    assignedTo: v.id("users"),
    /** Quién realizó la asignación */
    assignedBy: v.id("users"),
    /** Prioridad */
    priority: v.union(v.literal("normal"), v.literal("urgente"), v.literal("critico")),
    /** Estado de la asignación */
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    /** Fecha límite (ISO 8601) */
    dueDate: v.optional(v.string()),
    /** Notas adicionales */
    notes: v.optional(v.string()),
    /** Fecha de asignación (ISO 8601) */
    assignedAt: v.string(),
    /** Última actualización (ISO 8601) */
    updatedAt: v.string(),
  }).index("by_company", ["companyId"])
    .index("by_assigned_to", ["assignedTo"])
    .index("by_company_and_status", ["companyId", "status"]),

  // ─── DICOM Gateway — Recepción C-STORE ────────────────────────────────────

  /**
   * Estudios recibidos vía DICOM C-STORE desde el gateway externo.
   * Deduplicados por studyInstanceUid.
   */
  dicomInboundStudies: defineTable({
    /** DICOM Study Instance UID — clave de deduplicación */
    studyInstanceUid: v.string(),
    patientName: v.string(),
    patientId: v.string(),
    patientBirthDate: v.optional(v.string()),
    patientSex: v.optional(v.string()),
    studyDate: v.optional(v.string()),
    studyTime: v.optional(v.string()),
    studyDescription: v.optional(v.string()),
    accessionNumber: v.optional(v.string()),
    /** Modalidad principal */
    modality: v.string(),
    /** Número de series detectadas */
    seriesCount: v.number(),
    /** Instancias recibidas hasta ahora */
    instanceCount: v.number(),
    /** Estado de recepción */
    status: v.union(
      v.literal("receiving"),
      v.literal("received"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("error"),
    ),
    /** AE Title del equipo origen (RadiAnt, modalidad, etc.) */
    sourceAeTitle: v.optional(v.string()),
    /** IP del equipo origen */
    sourceIp: v.optional(v.string()),
    /** Primera instancia recibida (ISO 8601) */
    firstReceivedAt: v.string(),
    /** Última instancia recibida (ISO 8601) */
    lastReceivedAt: v.string(),
    /** Mensaje de error si status = error */
    errorMessage: v.optional(v.string()),
    /** Storage ID del ZIP DICOM en Convex File Storage (disponible al ser READY) */
    storageId: v.optional(v.string()),
    /** Link al worklistStudies una vez creado */
    worklistStudyId: v.optional(v.id("worklistStudies")),
  })
    .index("by_uid", ["studyInstanceUid"])
    .index("by_status", ["status"])
    .index("by_first_received_at", ["firstReceivedAt"]),

  /** Series de estudios recibidos vía C-STORE */
  dicomInboundSeries: defineTable({
    inboundStudyId: v.id("dicomInboundStudies"),
    studyInstanceUid: v.string(),
    seriesInstanceUid: v.string(),
    seriesNumber: v.optional(v.string()),
    seriesDescription: v.optional(v.string()),
    modality: v.string(),
    instanceCount: v.number(),
    firstReceivedAt: v.string(),
  })
    .index("by_study", ["inboundStudyId"])
    .index("by_series_uid", ["seriesInstanceUid"]),

  /** Instancias DICOM individuales recibidas vía C-STORE */
  dicomInboundInstances: defineTable({
    inboundStudyId: v.id("dicomInboundStudies"),
    inboundSeriesId: v.id("dicomInboundSeries"),
    studyInstanceUid: v.string(),
    seriesInstanceUid: v.string(),
    sopInstanceUid: v.string(),
    sopClassUid: v.optional(v.string()),
    instanceNumber: v.optional(v.string()),
    rows: v.optional(v.number()),
    columns: v.optional(v.number()),
    /** Ruta del archivo en el servidor gateway */
    filePath: v.string(),
    receivedAt: v.string(),
    /** Si era un duplicado ya recibido */
    isDuplicate: v.optional(v.boolean()),
  })
    .index("by_study", ["inboundStudyId"])
    .index("by_series", ["inboundSeriesId"])
    .index("by_sop_uid", ["sopInstanceUid"]),

  /** Logs del DICOM Gateway */
  dicomGatewayLogs: defineTable({
    level: v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
    event: v.string(),
    message: v.string(),
    sourceAeTitle: v.optional(v.string()),
    sourceIp: v.optional(v.string()),
    studyInstanceUid: v.optional(v.string()),
    sopInstanceUid: v.optional(v.string()),
    occurredAt: v.string(),
  })
    .index("by_occurred_at", ["occurredAt"])
    .index("by_level", ["level"]),

  /**
   * Estado global del DICOM Gateway (documento singleton, key="singleton").
   * Actualizado por el gateway vía heartbeat HTTP.
   */
  dicomGatewayStatus: defineTable({
    /** Siempre "singleton" */
    key: v.string(),
    aeTitle: v.string(),
    port: v.number(),
    /** IP del servidor gateway (enviada por el gateway) */
    serverIp: v.optional(v.string()),
    /** true si el último heartbeat fue hace < 90 segundos */
    isOnline: v.boolean(),
    lastHeartbeatAt: v.optional(v.string()),
    lastEchoAt: v.optional(v.string()),
    lastEchoSourceAe: v.optional(v.string()),
    lastStudyReceivedAt: v.optional(v.string()),
    lastStudyPatientName: v.optional(v.string()),
    lastStudyModality: v.optional(v.string()),
    totalStudiesReceived: v.number(),
    totalInstancesReceived: v.number(),
    totalErrors: v.number(),
    updatedAt: v.string(),
  })
    .index("by_key", ["key"]),
});
