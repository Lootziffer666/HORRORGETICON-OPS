
1. Gemeinsamer AppScreen-Typ
// AppScreen.kt (commonMain)

sealed interface AppScreen {
    // Leitstand
    data class Leitstand(val screen: LeitstandScreen) : AppScreen

    // Supervisor
    data class Supervisor(val screen: SupervisorScreen) : AppScreen

    // Actor
    data class Actor(val screen: ActorScreen) : AppScreen

    // Catering
    data class Catering(val screen: CateringScreen) : AppScreen
}
Damit hältst du das UI‑Routing auf einer Ebene und kannst später in der UI nach Rolle pattern‑matchen.
2. Selector: visibleScreensFor(AppState)
// AppSelectors.kt (commonMain)

fun visibleScreensFor(state: AppState): Set<AppScreen> = when (state.activeRole) {
    UserRole.LEITSTAND -> defaultLeitstandScreensFor(state.leitstandState)
        .map { AppScreen.Leitstand(it) }
        .toSet()

    UserRole.SUPERVISOR -> defaultSupervisorScreensFor(state.supervisorState)
        .map { AppScreen.Supervisor(it) }
        .toSet()

    UserRole.ACTOR -> defaultScreensFor(state.actorState)
        .map { AppScreen.Actor(it) }
        .toSet()

    UserRole.CATERING -> defaultCateringScreensFor(state.cateringState)
        .map { AppScreen.Catering(it) }
        .toSet()
}
defaultLeitstandScreensFor, defaultSupervisorScreensFor, defaultScreensFor (Actor) und defaultCateringScreensFor sind genau die Funktionen aus den vorherigen Schritten.
3. Beispiel: Use in UI (pseudocode)
Android Compose/Jetpack (oder Desktop):
@Composable
fun AppRoot(state: AppState) {
    val screens = visibleScreensFor(state)

    when (state.activeRole) {
        UserRole.ACTOR -> ActorScaffold(screens, state)
        UserRole.SUPERVISOR -> SupervisorScaffold(screens, state)
        UserRole.LEITSTAND -> LeitstandScaffold(screens, state)
        UserRole.CATERING -> CateringScaffold(screens, state)
    }
}
In den jeweiligen Scaffolds kannst du dann z.B. für Actor:
fun ActorScaffold(screens: Set<AppScreen>, state: AppState) {
    val actorScreens = screens
        .filterIsInstance<AppScreen.Actor>()
        .map { it.screen }
        .toSet()

    // z.B.:
    if (ActorScreen.LiveCueOverlay in actorScreens) {
        // Overlay rendern
    }
    if (ActorScreen.DayPlan in actorScreens) {
        // Haupt-Content
    }
}



***

## 1. Event-Lifecycle & Rollen

```kotlin
// AppLifecycle.kt (commonMain)

enum class EventLifecycle {
    DRAFT,
    APPROVED,
    BUILD_UP,   // Aufbau / Pre-Show
    LIVE,
    ENDED,
    POST_EVENT
}

enum class UserRole {
    LEITSTAND,
    SUPERVISOR,
    ACTOR,
    CATERING
    // Admin könnte separat kommen
}
```

Lifecycle passt zu deinen globalen Must‑Haves (Event‑Dashboard, Live‑Zeitplan, Post‑Event‑Features).[1]

***

## 2. AppState mit eingebetteten Teilzuständen

```kotlin
// AppState.kt (commonMain)

data class AppState(
    val lifecycle: EventLifecycle,
    val activeRole: UserRole,

    val leitstandState: LeitstandState,
    val supervisorState: SupervisorState,
    val actorState: ActorState,
    val cateringState: CateringState
)

fun initialAppState(): AppState = AppState(
    lifecycle = EventLifecycle.DRAFT,
    activeRole = UserRole.LEITSTAND,
    leitstandState = LeitstandState.PreEventConfig,
    supervisorState = SupervisorState.PreEventPrep,
    actorState = ActorState.PreEventInfo,
    cateringState = CateringState.PreEventPlanning
)
```

***

## 3. AppEvent: Rolle, Lifecycle, Delegation an Sub-Machines

```kotlin
// AppEvent.kt (commonMain)

sealed interface AppEvent {
    // Rolle wechseln (z.B. User hat Mehrfachrolle)
    data class RoleChanged(val role: UserRole) : AppEvent

    // Lifecycle-Events (UI, Backend, Scheduler)
    data object EventCreated : AppEvent
    data object EventApproved : AppEvent
    data object BuildUpStarted : AppEvent
    data object ShowStarted : AppEvent
    data object ShowEnded : AppEvent
    data object PostEventModeEntered : AppEvent

    // Delegierte Sub-Events
    data class Actor(val event: ActorEvent) : AppEvent
    data class Supervisor(val event: SupervisorEvent) : AppEvent
    data class Leitstand(val event: LeitstandEvent) : AppEvent
    data class Catering(val event: CateringEvent) : AppEvent
}
```

***

## 4. Zentraler App-Reducer

```kotlin
// AppReducer.kt (commonMain)

fun reduceAppState(
    state: AppState,
    event: AppEvent
): AppState = when (event) {

    is AppEvent.RoleChanged -> state.copy(
        activeRole = event.role
    )

    // Lifecycle -> beeinflusst v.a. Leitstand + andere States
    AppEvent.EventCreated -> state.copy(
        lifecycle = EventLifecycle.DRAFT,
        leitstandState = LeitstandState.PreEventConfig
    )

    AppEvent.EventApproved -> state.copy(
        lifecycle = EventLifecycle.APPROVED,
        leitstandState = reduceLeitstandState(state.leitstandState, LeitstandEvent.EventApproved)
    )

    AppEvent.BuildUpStarted -> state.copy(
        lifecycle = EventLifecycle.BUILD_UP,
        leitstandState = reduceLeitstandState(state.leitstandState, LeitstandEvent.BuildUpStarted),
        supervisorState = reduceSupervisorState(state.supervisorState, SupervisorEvent.BuildUpStarted),
        actorState = state.actorState, // bleibt PreEventInfo, bis DayOfEvent/FirstCall
        cateringState = reduceCateringState(state.cateringState, CateringEvent.DeliveriesStarted)
    )

    AppEvent.ShowStarted -> state.copy(
        lifecycle = EventLifecycle.LIVE,
        leitstandState = reduceLeitstandState(state.leitstandState, LeitstandEvent.ShowStarted),
        supervisorState = reduceSupervisorState(state.supervisorState, SupervisorEvent.ShowStarted),
        cateringState = reduceCateringState(state.cateringState, CateringEvent.LiveMealPeriodStarted)
    )

    AppEvent.ShowEnded -> state.copy(
        lifecycle = EventLifecycle.ENDED,
        leitstandState = reduceLeitstandState(state.leitstandState, LeitstandEvent.ShowEnded),
        supervisorState = reduceSupervisorState(state.supervisorState, SupervisorEvent.ShowEnded),
        cateringState = reduceCateringState(state.cateringState, CateringEvent.LiveMealPeriodEnded)
    )

    AppEvent.PostEventModeEntered -> state.copy(
        lifecycle = EventLifecycle.POST_EVENT,
        leitstandState = reduceLeitstandState(state.leitstandState, LeitstandEvent.ReportingRequested),
        supervisorState = reduceSupervisorState(state.supervisorState, SupervisorEvent.ShowEnded),
        cateringState = reduceCateringState(state.cateringState, CateringEvent.ReportingRequested)
    )

    // Delegation an Sub-State-Machines
    is AppEvent.Actor -> state.copy(
        actorState = reduceActorState(state.actorState, event.event)
    )

    is AppEvent.Supervisor -> state.copy(
        supervisorState = reduceSupervisorState(state.supervisorState, event.event)
    )

    is AppEvent.Leitstand -> state.copy(
        leitstandState = reduceLeitstandState(state.leitstandState, event.event)
    )

    is AppEvent.Catering -> state.copy(
        cateringState = reduceCateringState(state.cateringState, event.event)
    )
}
```

***



## Konzept: Zwei Catering-Ströme

- **Fremd‑Catering**  
  - Voucher‑basiert, QR-/Namensprüfung, „Hat gegessen“-Status, Warteschlangen‑ und Slot‑Logik.[1]
- **Team‑Verpflegung**  
  - Operativ eher wie „Crew Meal Scheduling“: Zeitfenster, Orte, grobe Mengen, kein Voucher‑Zwang.[1]

Im Domain‑Modell kannst du das so schärfen:

### 1. ServiceSlot um Typ ergänzen

```kotlin
enum class ServiceSlotKind {
    EXTERNAL_VOUCHER, // Fremd-Catering
    INTERNAL_TEAM     // Team-/Crew-Verpflegung
}

data class ServiceSlot(
    val id: String,
    val mealPeriodId: String,
    val label: String,
    val personGroup: PersonGroup,
    val start: String,
    val end: String,
    val status: ServiceSlotStatus,
    val currentQueueLength: Int,
    val capacityWarning: Boolean,
    val kind: ServiceSlotKind
)
```

- `EXTERNAL_VOUCHER`: nutzt QR‑/Namensprüfung und „Hat gegessen“-Status.[1]
- `INTERNAL_TEAM`: darf simpler sein (z.B. nur Slot sichtbar für Crew/Actors, keine harte Voucher‑Kontrolle).[1]

### 2. Scan‑Log nur für Fremd‑Catering

```kotlin
data class ServiceScanEntry(
    val personId: String?,
    val name: String?,
    val personGroup: PersonGroup,
    val hasEaten: Boolean,
    val lastScanAt: String,
    val slotKind: ServiceSlotKind
)
```

Frontend‑Konsequenz:

- `slot.kind == EXTERNAL_VOUCHER` → QR‑Ausgabeprüfung / Essensmarken‑Logik aktiv.[1]
- `slot.kind == INTERNAL_TEAM` → ggf. nur „Buffet geöffnet“-Status + grobe Ausgabestatistik, keine Person‑Ebene nötig.[1]

### 3. Team‑Verpflegung in anderen Rollen nutzbar machen

- **Supervisor**: in `SupervisorTeamDashboardProps` oder `ShiftControlProps` kannst du `nextMealSlotForTeam: ServiceSlot?` ergänzen, damit er Crew‑Essensfenster im Blick hat, ohne Voucher‑Details zu sehen.[1]
- **Actor**: im `ActorDayPlanProps` bleibt „Essens- und Pauseninfo“ als reine Info; bei Fremd‑Catering kannst du optional einen Link zum Voucher‑Slot anzeigen, musst aber nicht.[1]
- **Leitstand**: im `CommandCenterSnapshot` nur eine aggregierte Kennzahl wie `catering.statusText` und ggf. „Engpass Crew‑Verpflegung“ vs. „Engpass Fremd‑Catering“ trennen.[1]


***



***

## 1. Catering: State & Events

Aus deinen Must‑Haves: Planung → Liefer/Logistik → Live‑Ausgabe → Nachbereitung/Waste‑Analyse.[1]

### `CateringState.kt`

```kotlin
sealed interface CateringState {
    // Menü & Mengen planen
    data object PreEventPlanning : CateringState

    // Liefer- & Aufbauphase
    data object DeliveryAndSetup : CateringState

    // Live-Ausgabe / Service
    data object LiveService : CateringState

    // Nachbereitung / Waste / Analyse
    data object PostEventAnalysis : CateringState
}
```

### `CateringEvent.kt`

```kotlin
sealed interface CateringEvent {
    // Zeit / Phasen
    data object DayOfEvent : CateringEvent
    data object DeliveriesStarted : CateringEvent
    data object LiveMealPeriodStarted : CateringEvent
    data object LiveMealPeriodEnded : CateringEvent
    data object ReportingRequested : CateringEvent

    // Operative Trigger
    data object AllDeliveriesCompleted : CateringEvent
    data class CriticalShortage(val itemId: String) : CateringEvent
}
```

***

## 2. Catering-State-Machine (Reducer)

```kotlin
// CateringStateMachine.kt (commonMain)

fun reduceCateringState(
    current: CateringState,
    event: CateringEvent
): CateringState = when (current) {
    CateringState.PreEventPlanning -> when (event) {
        CateringEvent.DeliveriesStarted,
        CateringEvent.DayOfEvent -> CateringState.DeliveryAndSetup
        else -> current
    }

    CateringState.DeliveryAndSetup -> when (event) {
        CateringEvent.LiveMealPeriodStarted -> CateringState.LiveService
        CateringEvent.AllDeliveriesCompleted -> CateringState.LiveService
        else -> current
    }

    CateringState.LiveService -> when (event) {
        CateringEvent.LiveMealPeriodEnded,
        CateringEvent.ReportingRequested -> CateringState.PostEventAnalysis
        else -> current
    }

    CateringState.PostEventAnalysis -> when (event) {
        CateringEvent.DayOfEvent -> CateringState.PreEventPlanning
        else -> current
    }
}
```

Damit hast du: Planung → Logistik → Ausgabe → Analyse, inkl. Abkürzung in Live‑Service, wenn Lieferungen durch sind.[1]

***

## 3. Domain‑Typen für Catering

Basierend auf deinen Must‑Haves: Menü‑/Bestellverwaltung, Mengen/Forecast, Liefer‑/Logistik, Ausgabe/Slots, Allergien, Waste‑Tracking.[1]

```kotlin
// CateringDomain.kt

enum class DietLabel {
    VEGETARIAN,
    VEGAN,
    HALAL,
    KOSHER,
    GLUTEN_FREE,
    LACTOSE_FREE
}

data class AllergenInfo(
    val code: String,       // z.B. "A", "B", ...
    val description: String
)

data class MenuItem(
    val id: String,
    val name: String,
    val description: String?,
    val allergens: List<AllergenInfo>,
    val dietLabels: List<DietLabel>
)

enum class PersonGroup {
    GUEST,
    CREW,
    VIP,
    ACTOR
}

data class PortionPlan(
    val menuItemId: String,
    val personGroup: PersonGroup,
    val plannedPortions: Int,
    val specialDietNotes: String?
)

data class MealPeriod(
    val id: String,
    val label: String,    // "Lunch Crew", "VIP Dinner" ...
    val start: String,
    val end: String
)

// Forecast & Live-Verbrauch
data class ConsumptionForecast(
    val mealPeriodId: String,
    val menuItemId: String,
    val personGroup: PersonGroup,
    val forecastPortions: Int
)

data class ConsumptionActual(
    val mealPeriodId: String,
    val menuItemId: String,
    val personGroup: PersonGroup,
    val servedPortions: Int,
    val timestamp: String
)

data class ConsumptionRest(
    val mealPeriodId: String,
    val menuItemId: String,
    val estimatedRemaining: Int,
    val wastageEstimate: Int
)
```

Liefer‑/Logistik:

```kotlin
enum class DeliveryStatus {
    PLANNED,
    ON_ROUTE,
    ARRIVED,
    CHECKED_IN,
    REJECTED
}

data class DeliveryEntry(
    val id: String,
    val supplierName: String,
    val eta: String?,
    val zone: String,              // Lieferzone
    val status: DeliveryStatus,
    val temperatureOk: Boolean?,
    val hasPhotoProof: Boolean
)
```

Live‑Ausgabe / Slots / Queue:[1]

```kotlin
enum class ServiceSlotStatus {
    NOT_STARTED,
    OPEN,
    PAUSED,
    CLOSED
}

data class ServiceSlot(
    val id: String,
    val mealPeriodId: String,
    val label: String,
    val personGroup: PersonGroup,
    val start: String,
    val end: String,
    val status: ServiceSlotStatus,
    val currentQueueLength: Int,
    val capacityWarning: Boolean
)

data class ServiceScanEntry(
    val personId: String?,
    val name: String?,
    val personGroup: PersonGroup,
    val hasEaten: Boolean,
    val lastScanAt: String
)
```

Allergie‑ und Sonderkost‑Sicherheit:[1]

```kotlin
data class PersonDietProfile(
    val personId: String,
    val name: String,
    val allergens: List<AllergenInfo>,
    val dietLabels: List<DietLabel>,
    val critical: Boolean
)
```

Waste‑Tracking / Analyse:[1]

```kotlin
data class WasteEntry(
    val id: String,
    val menuItemId: String,
    val mealPeriodId: String,
    val quantity: Int,
    val reason: String?,      // z.B. "Overproduction", "Quality issue"
    val timestamp: String
)

data class CateringAnalysisSummary(
    val eventId: String,
    val totalProduced: Int,
    val totalServed: Int,
    val totalWaste: Int,
    val wasteByMenuItem: Map<String, Int>,
    val notes: String?
)
```

***

## 4. Screen‑Contracts für Catering

### 4.1 `CateringPlanningScreen`  
(Menü‑ und Bestellverwaltung + Mengen‑Forecast).[1]

```kotlin
data class CateringPlanningProps(
    val menuItems: List<MenuItem>,
    val mealPeriods: List<MealPeriod>,
    val portionPlans: List<PortionPlan>,
    val forecasts: List<ConsumptionForecast>
)
```

UI: Menüplan, Mahlzeiten nach Zeitfenster, Portionszahlen, Sonderkost, Allergene, VIP/Actor‑Anforderungen, Forecast pro Personengruppe.[1]

***

### 4.2 `CateringLogisticsScreen`  
(Liefer‑ und Logistikmanagement).[1]

```kotlin
data class CateringLogisticsProps(
    val deliveries: List<DeliveryEntry>,
    val contactForZone: Map<String, String> // zoneId -> Kontaktname / Hotline
)
```

UI: Lieferzeiten, Lieferantenkontakte, Lieferzone, Wareneingang, Temperaturkontrolle, Übergabestatus, Foto‑Nachweis, Reklamationen.[1]

***

### 4.3 `CateringLiveDashboardScreen`  
(Catering‑Dashboard während Live‑Service).[1]

```kotlin
data class CateringLiveDashboardProps(
    val currentMealPeriod: MealPeriod?,
    val personGroupCounts: Map<PersonGroup, Int>, // Anzahl Gäste / Crew / VIP / Actors
    val forecastByGroup: List<ConsumptionForecast>,
    val actualByGroup: List<ConsumptionActual>,
    val restByItem: List<ConsumptionRest>,
    val openIssuesCount: Int,
    val allergenWarnings: List<AllergenInfo>,
    val specialRequestsCount: Int
)
```

UI: aktuelle Meal Period, Soll‑/Ist‑Mengen, Engpässe, Allergene, Sonderwünsche, offene Aufgaben.[1]

***

### 4.4 `CateringServiceSlotsScreen`  
(Ausgabe‑ und Slot‑System).[1]

```kotlin
data class CateringServiceSlotsProps(
    val slots: List<ServiceSlot>,
    val recentScans: List<ServiceScanEntry>,
    val vipOrActorLists: List<PersonDietProfile> // VIP-/Actor-Sonderlisten
)
```

UI: Essensslots, Gruppenfreigabe, QR‑/Namensprüfung, „Hat gegessen“-Status, Warteschlangenstatus, Kapazitätswarnungen, VIP-/Actor‑Priorisierung.[1]

***

### 4.5 `CateringAllergySafetyScreen`  
(Allergie‑ und Sonderkost‑Sicherheit, kann als Detail‑View vom Dashboard erreichbar sein).[1]

```kotlin
data class CateringAllergySafetyProps(
    val globalAllergens: List<AllergenInfo>,
    val personProfiles: List<PersonDietProfile>,
    val criticalProfiles: List<PersonDietProfile>
)
```

UI: Allergene prominent anzeigen, Filter nach Einschränkungen, personenbezogene Sonderanforderungen, Bestätigung bei kritischen Allergenen, Notfallkontakt/medizinische Infos nach Berechtigung.[1]

***

### 4.6 `CateringWasteAnalysisScreen`  
(Waste‑Tracking + Post‑Event‑Verbrauchsanalyse).[1]

```kotlin
data class CateringWasteAnalysisProps(
    val wasteEntries: List<WasteEntry>,
    val summary: CateringAnalysisSummary
)
```

UI: Waste‑Tracking während/nach dem Event, Post‑Event‑Verbrauchsanalyse.[1]

***

## 5. Catering‑Router: Screens je State

```kotlin
sealed interface CateringScreen {
    data object Planning : CateringScreen
    data object Logistics : CateringScreen
    data object LiveDashboard : CateringScreen
    data object ServiceSlots : CateringScreen
    data object AllergySafety : CateringScreen
    data object WasteAnalysis : CateringScreen
}

fun defaultCateringScreensFor(
    state: CateringState
): Set<CateringScreen> = when (state) {
    CateringState.PreEventPlanning -> setOf(
        CateringScreen.Planning
    )

    CateringState.DeliveryAndSetup -> setOf(
        CateringScreen.Planning,
        CateringScreen.Logistics
    )

    CateringState.LiveService -> setOf(
        CateringScreen.LiveDashboard,
        CateringScreen.ServiceSlots,
        CateringScreen.AllergySafety
    )

    CateringState.PostEventAnalysis -> setOf(
        CateringScreen.WasteAnalysis,
        CateringScreen.LiveDashboard // als Kontext für Auswertung
    )
}
```

***



***

## 1. Leitstand: State & Events

### `LeitstandState.kt`

```kotlin
sealed interface LeitstandState {
    // Pre-Event: Konfiguration, Setup, Freigabe
    data object PreEventConfig : LeitstandState

    // Aufbau / Pre-Show: „Sind wir bereit?“
    data object PreShowMonitoring : LeitstandState

    // Live-Betrieb: Show läuft
    data object LiveCommand : LeitstandState

    // Nachbereitung / Reporting
    data object PostEventReview : LeitstandState
}
```

### `LeitstandEvent.kt`

```kotlin
sealed interface LeitstandEvent {
    // Lebenszyklus des Events
    data object EventCreated : LeitstandEvent
    data object EventApproved : LeitstandEvent
    data object BuildUpStarted : LeitstandEvent
    data object ShowStarted : LeitstandEvent
    data object ShowEnded : LeitstandEvent
    data object ReportingRequested : LeitstandEvent

    // Operative Trigger
    data class CriticalIncidentRaised(val incidentId: String) : LeitstandEvent
    data class MajorDelayDetected(val minutes: Int) : LeitstandEvent
    data object NetworkDegraded : LeitstandEvent
    data object NetworkRecovered : LeitstandEvent
}
```

***

## 2. Leitstand-State-Machine (Reducer)

```kotlin
// LeitstandStateMachine.kt (commonMain)

fun reduceLeitstandState(
    current: LeitstandState,
    event: LeitstandEvent
): LeitstandState = when (current) {
    LeitstandState.PreEventConfig -> when (event) {
        LeitstandEvent.BuildUpStarted,
        LeitstandEvent.EventApproved -> LeitstandState.PreShowMonitoring
        else -> current
    }

    LeitstandState.PreShowMonitoring -> when (event) {
        LeitstandEvent.ShowStarted -> LeitstandState.LiveCommand
        is LeitstandEvent.CriticalIncidentRaised -> LeitstandState.LiveCommand
        else -> current
    }

    LeitstandState.LiveCommand -> when (event) {
        LeitstandEvent.ShowEnded -> LeitstandState.PostEventReview
        LeitstandEvent.ReportingRequested -> LeitstandState.PostEventReview
        else -> current
    }

    LeitstandState.PostEventReview -> when (event) {
        LeitstandEvent.EventCreated -> LeitstandState.PreEventConfig
        else -> current
    }
}
```

Das spiegelt dein Modell: Pre‑Event‑Setup → Pre‑Show‑Monitoring → Live‑Kommandozentrale → Reporting/Nachbereitung.[1]

***

## 3. Domain‑Typen für Leitstand

### 3.1 Command‑Center / Lagebild

```kotlin
enum class AreaTrafficLight {
    GREEN,
    YELLOW,
    RED
}

data class AreaStatusSummary(
    val areaId: String,
    val name: String,
    val light: AreaTrafficLight,
    val criticalTasksCount: Int,
    val openIncidentsCount: Int,
    val delayMinutes: Int
)

data class EventLiveStatus(
    val eventPhase: String,          // "PRE_SHOW", "LIVE", "BREAK", "ENDED" ...
    val currentProgramBlock: String?,
    val next15MinutesPreview: String
)

data class PersonnelAvailabilitySummary(
    val totalPlanned: Int,
    val present: Int,
    val late: Int,
    val missing: Int
)

data class CateringStatusSummary(
    val statusText: String,
    val hasCriticalIssues: Boolean
)

data class CommsStatusSummary(
    val lastBroadcastAt: String?,
    val failedDeliveriesCount: Int,
    val unreadCriticalCount: Int
)

data class CommandCenterSnapshot(
    val eventStatus: EventLiveStatus,
    val areas: List<AreaStatusSummary>,
    val personnel: PersonnelAvailabilitySummary,
    val catering: CateringStatusSummary,
    val comms: CommsStatusSummary,
    val decisionLogEntries: List<DecisionLogEntry>
)

data class DecisionLogEntry(
    val id: String,
    val timestamp: String,
    val text: String,
    val author: String
)
```

### 3.2 Live‑Monitoring / Tasks / Check‑ins

```kotlin
data class SupervisorLiveStatus(
    val supervisorId: String,
    val name: String,
    val areaId: String?,
    val statusText: String
)

data class ActorReadinessSummary(
    val readyCount: Int,
    val notReadyCount: Int,
    val lateCount: Int
)

data class CheckinStats(
    val totalExpected: Int,
    val checkedIn: Int,
    val late: Int,
    val missing: Int
)

data class SystemHealthStatus(
    val networkOk: Boolean,
    val syncOk: Boolean,
    val lastOutageAt: String?
)

data class LiveMonitoringSnapshot(
    val tasksByStatus: Map<String, Int>, // z.B. "OPEN" -> 12
    val supervisors: List<SupervisorLiveStatus>,
    val actorReadiness: ActorReadinessSummary,
    val cateringDeliveryStatus: String,
    val checkinStats: CheckinStats,
    val escalationsCount: Int,
    val systemHealth: SystemHealthStatus
)
```

### 3.3 Dispatch / Timeline / Incidents / Comms

```kotlin
enum class DispatchTargetType {
    SUPERVISOR,
    PERSON
}

data class DispatchTarget(
    val id: String,
    val type: DispatchTargetType,
    val name: String,
    val areaId: String?
)

data class DispatchTaskBundle(
    val id: String,
    val title: String,
    val taskIds: List<String>,
    val priority: Int
)

data class TimelineEntry(
    val id: String,
    val start: String,
    val end: String,
    val title: String,
    val type: String,     // PROGRAM, BUFFER, BREAK ...
    val affectedRoles: List<String>,
    val isDelayed: Boolean,
    val delayMinutes: Int
)

data class TimelineVersion(
    val id: String,
    val createdAt: String,
    val reason: String
)

data class BroadcastTemplate(
    val id: String,
    val title: String,
    val body: String
)

enum class BroadcastScope {
    ALL,
    ROLE,
    AREA,
    TEAM
}

data class BroadcastTarget(
    val scope: BroadcastScope,
    val role: String? = null,
    val areaId: String? = null,
    val teamId: String? = null
)

data class BroadcastMessage(
    val id: String,
    val templateId: String?,
    val body: String,
    val target: BroadcastTarget,
    val requiresAck: Boolean,
    val sentAt: String,
    val notReachedCount: Int
)
```

Incidents (kannst du 1:1 mit Supervisor/Actor teilen, hier nur kurze Referenz):

```kotlin
// Incident, IncidentCategory, IncidentSeverity, IncidentStatus
// wie beim Supervisor, zusätzlich SLA / Zeitlimit für Leitstand

data class IncidentSlaInfo(
    val incidentId: String,
    val targetMinutes: Int,
    val elapsedMinutes: Int
)
```

Reporting:

```kotlin
data class ReportingSummary(
    val eventId: String,
    val taskCompletionRate: Double,
    val incidentsTotal: Int,
    val incidentsBySeverity: Map<String, Int>,
    val avgReactionTimeSeconds: Long,
    val checkinStats: CheckinStats,
    val cateringDeviationText: String?,
    val actorPunctualityRate: Double
)
```

***

## 4. Screen‑Contracts (Props) für Leitstand

### 4.1 `LeitstandCommandCenterDashboard`  
(Command‑Center‑Dashboard / Event‑Dashboard / Lagebild).[1]

```kotlin
data class LeitstandCommandCenterDashboardProps(
    val snapshot: CommandCenterSnapshot
)
```

UI: große Operations‑Ansicht, Ampeln pro Team/Zone, „Nächste 15 Minuten“-Vorschau, Schnellzugriff auf Notfälle, Entscheidungslog.[1]

***

### 4.2 `LeitstandLiveMonitoringPanel`  
(Live‑Monitoring).[1]

```kotlin
data class LeitstandLiveMonitoringPanelProps(
    val snapshot: LiveMonitoringSnapshot
)
```

UI: Aufgabenfortschritt in Echtzeit, Supervisor‑Status, Actor‑Bereitschaft, Check‑in‑Quote, Verspätungen, Eskalationen, Systemwarnungen, Netzwerk/Sync‑Status.[1]

***

### 4.3 `LeitstandDispatchBoard`  
(Dispatch & Reassignment).[1]

```kotlin
data class LeitstandDispatchBoardProps(
    val pendingTasks: List<TaskItem>,
    val supervisors: List<DispatchTarget>,
    val individuals: List<DispatchTarget>,
    val bundles: List<DispatchTaskBundle>
)
```

Typische Aktionen:  
- Aufgaben an Supervisoren oder Personen verteilen, Priorität ändern, Zuständigkeit wechseln, Task‑Bundles versenden, duplizieren, Eskalation auslösen, Sofort‑Broadcast koppeln.[1]

***

### 4.4 `LeitstandIncidentControlPanel`  
(Incident‑Control).[1]

```kotlin
data class LeitstandIncidentControlPanelProps(
    val incidents: List<Incident>,
    val slaInfo: List<IncidentSlaInfo>
)
```

UI: zentrale Incident‑Übersicht, Kritikalitätsstufen, SLA/Zeitanzeige, Maßnahmenverfolgung, Eskalationsketten, Abschlussfreigabe, Nachbericht/Export.[1]

***

### 4.5 `LeitstandMasterTimelineView`  
(Master‑Timeline‑Steuerung).[1]

```kotlin
data class LeitstandMasterTimelineViewProps(
    val currentEntries: List<TimelineEntry>,
    val activeVersion: TimelineVersion,
    val previousVersions: List<TimelineVersion>
)
```

Aktionen: Programmänderungen eintragen, Verzögerungen propagieren, abhängige Rollen automatisch informieren, neue Call Times setzen, „Freeze Timeline“, Versionen vergleichen, Änderungsgrund dokumentieren.[1]

***

### 4.6 `LeitstandCommsCenter`  
(Kommunikationszentrale).[1]

```kotlin
data class LeitstandCommsCenterProps(
    val templates: List<BroadcastTemplate>,
    val recentBroadcasts: List<BroadcastMessage>
)
```

UI: Broadcast an alle / nach Rolle / Zone / Team, Pflichtbestätigung, Notfallmodus, Kommunikationshistorie, nicht erreichte Personen.[1]

***

### 4.7 `LeitstandReportingView`  
(Reporting & Nachbereitung).[1]

```kotlin
data class LeitstandReportingViewProps(
    val summary: ReportingSummary
)
```

UI: Eventprotokoll, Task‑Completion‑Rate, Incident‑Auswertung, Reaktionszeiten, Check‑in‑Statistiken, Catering‑Abweichungen, Actor‑Pünktlichkeit, Export/„Lessons Learned“‑Bereich.[1]

***

## 5. Leitstand‑Router: Screens pro State

```kotlin
sealed interface LeitstandScreen {
    data object CommandCenterDashboard : LeitstandScreen
    data object LiveMonitoringPanel : LeitstandScreen
    data object DispatchBoard : LeitstandScreen
    data object IncidentControlPanel : LeitstandScreen
    data object MasterTimelineView : LeitstandScreen
    data object CommsCenter : LeitstandScreen
    data object ReportingView : LeitstandScreen
}

fun defaultLeitstandScreensFor(
    state: LeitstandState
): Set<LeitstandScreen> = when (state) {
    LeitstandState.PreEventConfig -> setOf(
        LeitstandScreen.MasterTimelineView,
        LeitstandScreen.CommsCenter // z.B. für Pre‑Event‑Broadcasts/Briefings
    )

    LeitstandState.PreShowMonitoring -> setOf(
        LeitstandScreen.CommandCenterDashboard,
        LeitstandScreen.LiveMonitoringPanel,
        LeitstandScreen.DispatchBoard,
        LeitstandScreen.MasterTimelineView,
        LeitstandScreen.CommsCenter
    )

    LeitstandState.LiveCommand -> setOf(
        LeitstandScreen.CommandCenterDashboard,
        LeitstandScreen.LiveMonitoringPanel,
        LeitstandScreen.DispatchBoard,
        LeitstandScreen.IncidentControlPanel,
        LeitstandScreen.MasterTimelineView,
        LeitstandScreen.CommsCenter
    )

    LeitstandState.PostEventReview -> setOf(
        LeitstandScreen.ReportingView,
        LeitstandScreen.IncidentControlPanel,
        LeitstandScreen.MasterTimelineView
    )
}
```

***



***

## 1. Supervisor: State & Events

Aus deinem Dokument leiten sich für Supervisor klar vier Phasen ab: Vorbereitung, Aufbau/Pre‑Show, Live‑Runde und Schicht‑Übergabe/Nachbereitung.[1]

### `SupervisorState.kt`

```kotlin
sealed interface SupervisorState {
    data object PreEventPrep : SupervisorState
    data object PreShowSetup : SupervisorState
    data object LiveRound : SupervisorState
    data object ShiftHandover : SupervisorState
}
```

### `SupervisorEvent.kt`

```kotlin
sealed interface SupervisorEvent {
    // Zeit / Event-Status
    data object DayOfEvent : SupervisorEvent
    data object BuildUpStarted : SupervisorEvent      // Aufbau/Pre-Show beginnt
    data object ShowStarted : SupervisorEvent        // Run of Show läuft
    data object ShowEndedForArea : SupervisorEvent   // Bereich fertig

    // Schicht-Logik
    data object ShiftStarted : SupervisorEvent
    data object ShiftEnded : SupervisorEvent

    // Operationelle Events (optional für State-Guards)
    data class TasksAssigned(val count: Int) : SupervisorEvent
    data class CriticalIncidentRaised(val incidentId: String) : SupervisorEvent
}
```

***

## 2. Supervisor-State-Machine (Reducer)

```kotlin
// SupervisorStateMachine.kt (commonMain)

fun reduceSupervisorState(
    current: SupervisorState,
    event: SupervisorEvent
): SupervisorState = when (current) {
    SupervisorState.PreEventPrep -> when (event) {
        SupervisorEvent.BuildUpStarted,
        SupervisorEvent.DayOfEvent -> SupervisorState.PreShowSetup

        SupervisorEvent.ShiftStarted -> SupervisorState.PreShowSetup

        else -> current
    }

    SupervisorState.PreShowSetup -> when (event) {
        SupervisorEvent.ShowStarted -> SupervisorState.LiveRound
        is SupervisorEvent.CriticalIncidentRaised -> SupervisorState.LiveRound
        SupervisorEvent.ShiftEnded -> SupervisorState.ShiftHandover
        else -> current
    }

    SupervisorState.LiveRound -> when (event) {
        SupervisorEvent.ShowEndedForArea -> SupervisorState.ShiftHandover
        SupervisorEvent.ShiftEnded -> SupervisorState.ShiftHandover
        else -> current
    }

    SupervisorState.ShiftHandover -> when (event) {
        // Neuer Tag / neues Event → zurück in Vorbereitung
        SupervisorEvent.DayOfEvent -> SupervisorState.PreEventPrep
        else -> current
    }
}
```

Die Transitions spiegeln:  
- Pre‑Event‑Vorbereitung → Pre‑Show/ Aufbau, wenn Event/Schicht startet.[1]
- Pre‑Show → Live‑Runde bei Showstart oder ersten kritischen Incidents.[1]
- Live‑Runde → Schicht‑Übergabe, wenn Show im eigenen Bereich durch oder Schichtende.[1]

***

## 3. Domain‑Typen für Supervisor

Basierend auf deinen Must‑Haves: Team‑/Bereichsübersicht, Aufgabenannahme/Weitergabe, Team‑Kommunikation, Schicht‑/Personalsteuerung, Vor‑Ort‑Checklisten und Eskalation.[1]

```kotlin
// SupervisorDomain.kt

enum class PersonAvailability {
    AVAILABLE,
    BUSY,
    OFFLINE,
    ON_BREAK
}

data class TeamMember(
    val id: String,
    val name: String,
    val role: String,
    val availability: PersonAvailability,
    val isPresent: Boolean,
    val isAbsent: Boolean,
    val zone: String?
)

enum class TaskStatus {
    OPEN,
    ACCEPTED,
    IN_PROGRESS,
    BLOCKED,
    DONE,
    CONFIRMED
}

data class TaskItem(
    val id: String,
    val title: String,
    val description: String?,
    val status: TaskStatus,
    val deadline: String?,          // ISO-8601
    val zone: String?,
    val assigneeId: String?,        // TeamMember.id
    val hasPhotoProof: Boolean,
    val isCritical: Boolean
)

enum class ZoneStatus {
    OK,
    ATTENTION,
    PROBLEM
}

data class ZoneOverview(
    val id: String,
    val name: String,
    val status: ZoneStatus,
    val openProblemsCount: Int
)

data class MaterialStatus(
    val zoneId: String,
    val ok: Boolean,
    val notes: String?
)

data class SupervisorAreaOverview(
    val team: List<TeamMember>,
    val tasks: List<TaskItem>,
    val zones: List<ZoneOverview>,
    val materials: List<MaterialStatus>
)
```

Checklisten & Incidents:

```kotlin
enum class ChecklistType {
    BUILD_UP,
    SAFETY,
    ROOM,
    TECH,
    CATERING_HANDOVER,
    PRE_SHOW,
    POST_EVENT
}

data class ChecklistItem(
    val id: String,
    val text: String,
    val isMandatory: Boolean,
    val isDone: Boolean
)

data class Checklist(
    val id: String,
    val type: ChecklistType,
    val title: String,
    val items: List<ChecklistItem>,
    val requiresProof: Boolean
)

enum class IncidentCategory {
    TECH,
    SAFETY,
    PERSONNEL,
    CATERING,
    SCHEDULE,
    GUEST,
    MEDICAL
}

enum class IncidentSeverity {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}

enum class IncidentStatus {
    OPEN,
    IN_PROGRESS,
    ESCALATED,
    RESOLVED
}

data class Incident(
    val id: String,
    val category: IncidentCategory,
    val severity: IncidentSeverity,
    val status: IncidentStatus,
    val title: String,
    val description: String?,
    val zone: String?,
    val createdAt: String,
    val updatedAt: String,
    val photoIds: List<String>,
    val assignedTo: String? // Leitstand oder Rolle
)
```

***

## 4. Screen‑Contracts (Props) für Supervisor

### 4.1 `SupervisorTeamDashboard`  
(entspricht Team‑ und Bereichsübersicht + Aufgaben‑Status + Zonenstatus + offene Probleme + Prioritätenliste).[1]

```kotlin
data class SupervisorTeamDashboardProps(
    val overview: SupervisorAreaOverview,
    val priorityTaskIds: List<String>, // Prioritätenliste
    val openProblemsCount: Int
)
```

Typische Aktionen (im ViewModel, nicht als Typen nötig):  
- Aufgabe öffnen, Status ändern, an Teammitglied delegieren, Blocker melden, Foto hochladen.[1]

***

### 4.2 `SupervisorTaskInbox`  
(Aufgabenannahme vom Leitstand + Weitergabe).[1]

```kotlin
data class SupervisorTaskInboxProps(
    val incomingTasks: List<TaskItem>,   // vom Leitstand zugewiesen
    val teamMembers: List<TeamMember>
)
```

Aktionen:  
- `acceptTask(taskId)` – Aufgaben vom Leitstand annehmen.[1]
- `delegateTask(taskId, memberId)` – an Teammember delegieren.[1]
- `updateTaskStatus(taskId, status)` – inkl. Blocker melden.[1]
- `confirmTaskDone(taskId)` – Abschluss bestätigen, ggf. Foto‑Nachweis.[1]

***

### 4.3 `SupervisorTeamComms`  
(Team‑Kommunikation).[1]

```kotlin
enum class TeamMessageType {
    NORMAL,
    BROADCAST,
    QUESTION_TO_CONTROL
}

data class TeamMessage(
    val id: String,
    val senderId: String,
    val text: String,
    val type: TeamMessageType,
    val createdAt: String,
    val isSilent: Boolean
)

data class SupervisorTeamCommsProps(
    val teamMembers: List<TeamMember>,
    val messages: List<TeamMessage>,
    val unreadCount: Int
)
```

Aktionen:  
- `sendTeamBroadcast(text)` – Broadcast an eigenes Team.[1]
- `sendSilentUpdate(text)` – Statusupdate ohne Chat‑Flut.[1]
- `askControl(text)` – Rückfrage an Leitstand.[1]

***

### 4.4 `SupervisorShiftControl`  
(Schicht‑ und Personalsteuerung: Check‑in prüfen, Ersatzpersonen, Pausen, Verfügbarkeit, Überlastung, kurzfristige Umverteilung).[1]

```kotlin
data class ShiftMemberStatus(
    val member: TeamMember,
    val isOnShift: Boolean,
    val currentTaskCount: Int,
    val isOverloaded: Boolean,
    val onBreak: Boolean
)

data class SupervisorShiftControlProps(
    val shiftMembers: List<ShiftMemberStatus>,
    val availableReplacementPool: List<TeamMember> // Kandidaten für Ersatzpersonen
)
```

Aktionen:  
- `requestReplacement(forMemberId)` – schnelle Ersatzperson‑Anfrage.[1]
- `scheduleBreak(memberId, start, end)` – Pausen koordinieren.[1]
- `reassignTask(taskId, newAssigneeId)` – kurzfristige Umverteilung.[1]

***

### 4.5 `SupervisorChecklistRunner`  
(Vor‑Ort‑Checklisten: Aufbau, Sicherheit, Raum, Technik, Catering‑Übergabe, Pre‑Show, Post‑Event).[1]

```kotlin
data class SupervisorChecklistRunnerProps(
    val checklist: Checklist,
    val zone: ZoneOverview?,
    val canWorkOffline: Boolean
)
```

Aktionen:  
- `toggleItem(checklistId, itemId)` – Item abhaken.[1]
- `attachPhoto(checklistId, itemId, imageRef)` – Pflichtnachweise.[1]

***

### 4.6 `SupervisorIncidentPanel`  
(Eskalationsfunktion: Problem melden, Priorität setzen, Leitstand benachrichtigen, Foto/Kommentar, Status verfolgen, Lösung bestätigen).[1]

```kotlin
data class SupervisorIncidentPanelProps(
    val incidents: List<Incident>,
    val relatedTasks: List<TaskItem>,
    val currentZone: ZoneOverview?
)
```

Aktionen:  
- `createIncident(category, severity, title, description, zoneId, photoIds)`.[1]
- `updateIncidentStatus(incidentId, status)` – Lösung bestätigen.[1]
- `escalateIncident(incidentId)` – Leitstand benachrichtigen.[1]

***

## 5. Supervisor‑Router: Welche Screens in welchem State?

```kotlin
sealed interface SupervisorScreen {
    data object TeamDashboard : SupervisorScreen
    data object TaskInbox : SupervisorScreen
    data object TeamComms : SupervisorScreen
    data object ShiftControl : SupervisorScreen
    data object ChecklistRunner : SupervisorScreen
    data object IncidentPanel : SupervisorScreen
    data object HandoverSummary : SupervisorScreen
}

fun defaultSupervisorScreensFor(
    state: SupervisorState
): Set<SupervisorScreen> = when (state) {
    SupervisorState.PreEventPrep -> setOf(
        SupervisorScreen.TeamDashboard,    // Übersicht Team/Zonen/Material
        SupervisorScreen.ChecklistRunner   // vorbereitende Checks, falls genutzt
    )

    SupervisorState.PreShowSetup -> setOf(
        SupervisorScreen.TeamDashboard,
        SupervisorScreen.TaskInbox,
        SupervisorScreen.TeamComms,
        SupervisorScreen.ShiftControl,
        SupervisorScreen.ChecklistRunner
    )

    SupervisorState.LiveRound -> setOf(
        SupervisorScreen.TeamDashboard,
        SupervisorScreen.TaskInbox,
        SupervisorScreen.TeamComms,
        SupervisorScreen.ShiftControl,
        SupervisorScreen.ChecklistRunner,
        SupervisorScreen.IncidentPanel
    )

    SupervisorState.ShiftHandover -> setOf(
        SupervisorScreen.HandoverSummary,
        SupervisorScreen.IncidentPanel
    )
}
```

***



***

## 1. State & Events (Shared Logic)

```kotlin
// ActorState.kt (commonMain)

sealed interface ActorState {
    data object PreEventInfo : ActorState
    data object DayOfPreShow : ActorState
    data object LiveOnShow : ActorState
    data object PostShow : ActorState
}

sealed interface ActorEvent {
    data object EventPublished : ActorEvent
    data object DayOfEvent : ActorEvent
    data object CheckinPerformed : ActorEvent
    data object FirstCalltimeReached : ActorEvent
    data class CueReceived(
        val type: CueType,
        val requiresAck: Boolean
    ) : ActorEvent
    data object ShowDoneForActor : ActorEvent
}

enum class CueType {
    GET_READY,
    GO_TO_POSITION,
    DELAY,
    CHANGE_OF_PLAN
}
```

***

## 2. Zustandsübergänge als Pure Function

```kotlin
// ActorStateMachine.kt (commonMain)

fun reduceActorState(
    current: ActorState,
    event: ActorEvent
): ActorState = when (current) {
    ActorState.PreEventInfo -> when (event) {
        ActorEvent.DayOfEvent -> ActorState.DayOfPreShow
        is ActorEvent.CueReceived ->
            if (event.type == CueType.CHANGE_OF_PLAN && event.requiresAck) {
                ActorState.LiveOnShow
            } else current
        else -> current
    }

    ActorState.DayOfPreShow -> when (event) {
        ActorEvent.FirstCalltimeReached -> ActorState.LiveOnShow
        is ActorEvent.CueReceived ->
            if (event.type == CueType.GET_READY || event.type == CueType.GO_TO_POSITION) {
                ActorState.LiveOnShow
            } else current
        else -> current
    }

    ActorState.LiveOnShow -> when (event) {
        ActorEvent.ShowDoneForActor -> ActorState.PostShow
        else -> current
    }

    ActorState.PostShow -> current
}
```

Das ist bewusst minimal und ohne Side‑Effects – perfekt für Tests in `commonTest` und für einen einfachen Redux‑/MVI‑Style Store.[1]

***

## 3. Domain Types (Slots, Contacts, Docs)

```kotlin
// ActorDomain.kt (commonMain)

data class EventBlock(
    val title: String,
    val start: String, // ISO-8601 Time
    val end: String
)

data class Contact(
    val name: String,
    val role: String,
    val phone: String?,
    val isPrimaryContact: Boolean
)

data class LocationInfo(
    val address: String,
    val zone: String?,
    val notes: String?
)

data class TravelInfo(
    val arrival: String?,
    val departure: String?,
    val hotel: String?,
    val transport: String?
)

enum class ActorSlotType {
    PROBE,
    SHOW,
    STYLING,
    MEETING,
    BREAK
}

data class ActorSlot(
    val id: String,
    val type: ActorSlotType,
    val start: String,
    val end: String,
    val location: String,
    val zone: String?,
    val isCurrent: Boolean,
    val isNext: Boolean
)

data class PlanChange(
    val timestamp: String,
    val description: String
)

enum class ActorStatus {
    OFFLINE,
    ON_THE_WAY,
    CHECKED_IN,
    READY,
    IN_MASK,
    BACKSTAGE,
    ON_POSITION,
    NOT_AVAILABLE
}

data class Cue(
    val id: String,
    val type: CueType,
    val message: String,
    val effectiveAt: String?,
    val requiresAck: Boolean
)

data class CuePreview(
    val label: String
)

data class DocRef(
    val id: String,
    val title: String
)

data class ImageRef(
    val id: String
)
```

***

## 4. Screen Contracts als KMP‑Datenklassen

### `ActorEventOverview`

```kotlin
data class ActorEventOverviewProps(
    val actorRole: String,
    val eventSummary: String,
    val highLevelSchedule: List<EventBlock>,
    val dressCode: String,
    val contacts: List<Contact>,
    val locationInfo: LocationInfo,
    val travelAndStay: TravelInfo?
)
```

### `ActorDayPlan`

```kotlin
enum class CheckinStatus {
    NOT_CHECKED_IN,
    CHECKED_IN
}

data class ActorDayPlanProps(
    val callTime: String,
    val slots: List<ActorSlot>,
    val realTimeChanges: List<PlanChange>,
    val nextSlotCountdownSeconds: Long,
    val checkinStatus: CheckinStatus,
    val readOnly: Boolean
)
```

### `ActorStatusPanel`

```kotlin
data class ActorStatusPanelProps(
    val currentStatus: ActorStatus,
    val lateFlag: Boolean,
    val assignedSupervisor: Contact
)
```

### `ActorLiveCueOverlay`

```kotlin
data class ActorLiveCueOverlayProps(
    val activeCue: Cue?,
    val nextCuePreview: CuePreview?
)
```

### `ActorSupervisorComms`

```kotlin
enum class QuickActionType {
    QUESTION,
    PROBLEM,
    LATE,
    AVAILABILITY,
    EMERGENCY
}

data class QuickActionTemplate(
    val id: String,
    val label: String,
    val type: QuickActionType
)

data class ActorSupervisorCommsProps(
    val supervisor: Contact,
    val quickActions: List<QuickActionTemplate>
)
```

### `ActorDocs` / `ActorPersonalRequirements` / `ActorPostShowInfo`

```kotlin
data class ActorDocsProps(
    val briefingDoc: DocRef?,
    val scriptDoc: DocRef?,
    val safetyDoc: DocRef?,
    val mediaConsentDoc: DocRef?,
    val locationHintsDoc: DocRef?,
    val wardrobeInfoDoc: DocRef?
)

data class ActorPersonalRequirementsProps(
    val allergiesAndDiet: String?,
    val costumeEquipmentNeeds: String?,
    val travelStatus: String?,
    val accommodation: String?,
    val transportDetails: String?,
    val wardrobeRoom: String?
)

data class ActorPostShowInfoProps(
    val wrapUpMessage: String,
    val transportBackInfo: String?,
    val feedbackLink: String?
)
```

***

## 5. Ein einfacher Router in Shared Code

Du kannst dir noch einen kleinen „Routing‑Layer“ bauen, der aus `ActorState` → die passenden Screens ableitet:

```kotlin
sealed interface ActorScreen {
    data object EventOverview : ActorScreen
    data object DayPlan : ActorScreen
    data object StatusPanel : ActorScreen
    data object LiveCueOverlay : ActorScreen
    data object SupervisorComms : ActorScreen
    data object Docs : ActorScreen
    data object PersonalRequirements : ActorScreen
    data object PostShowInfo : ActorScreen
}

fun defaultScreensFor(state: ActorState): Set<ActorScreen> = when (state) {
    ActorState.PreEventInfo -> setOf(
        ActorScreen.EventOverview,
        ActorScreen.Docs,
        ActorScreen.PersonalRequirements
    )
    ActorState.DayOfPreShow -> setOf(
        ActorScreen.EventOverview,
        ActorScreen.DayPlan,
        ActorScreen.StatusPanel,
        ActorScreen.SupervisorComms,
        ActorScreen.Docs
    )
    ActorState.LiveOnShow -> setOf(
        ActorScreen.EventOverview,
        ActorScreen.DayPlan,
        ActorScreen.StatusPanel,
        ActorScreen.LiveCueOverlay,
        ActorScreen.SupervisorComms,
        ActorScreen.Docs
    )
    ActorState.PostShow -> setOf(
        ActorScreen.EventOverview,
        ActorScreen.PostShowInfo
    )
}
```


***

## Actor: Zustandsautomat

### Zustände

- `PRE_EVENT_INFO` – Event steht bevor, Actor zieht nur Infos.[1]
- `DAY_OF_PRESHOW` – Eventtag, Fokus auf Tagesplan und Ankunft.[1]
- `LIVE_ON_SHOW` – Show läuft, Fokus auf Cues und Bereitschaft.[1]
- `POST_SHOW` – Nach Auftritt, nur noch Restinfos/Abreise.[1]

### Wichtige Events

- `EVENT_PUBLISHED` – Event/Briefing ist freigegeben.[1]
- `DAY_OF_EVENT` – aktuelles Datum = Eventdatum.[1]
- `CHECKIN_PERFORMED` – Actor bestätigt Ankunft (QR oder manuell).[1]
- `FIRST_CALLTIME_REACHED` – erste relevante Call Time auf dem Tagesplan ist „aktiv“.[1]
- `CUE_RECEIVED` – Call/Cue vom System (Bereitmachen / Auf Position / Verzögerung / Ablaufänderung).[1]
- `SHOW_DONE_FOR_ACTOR` – letzter relevanter Programmpunkt des Actors abgeschlossen.[1]

### Transitions

- Start → `PRE_EVENT_INFO`  
  - Bedingung: `EVENT_PUBLISHED`, Actor hat Event‑Zugang.[1]

- `PRE_EVENT_INFO` → `DAY_OF_PRESHOW`  
  - Trigger: `DAY_OF_EVENT`.[1]

- `DAY_OF_PRESHOW` → `LIVE_ON_SHOW`  
  - Trigger: `FIRST_CALLTIME_REACHED` oder erster `CUE_RECEIVED`.[1]

- `LIVE_ON_SHOW` → `POST_SHOW`  
  - Trigger: `SHOW_DONE_FOR_ACTOR` (z.B. letzter Auftritt + Check‑out).[1]

- Jeder Zustand → `LIVE_ON_SHOW`  
  - Trigger: Notfall‑Cues (z.B. kurzfristige Planänderung, „Bitte sofort Backstage“).[1]

***

## Actor: Screen Contracts (rollen- und zustandsbasiert)

### 1. Screen: `ActorEventOverview` (State: `PRE_EVENT_INFO`)

**Zweck:** Pre‑Event‑„Landing Page“: Worum geht es, welche Rolle habe ich, was kommt grob auf mich zu.[1]

**Props (Read‑only):**

- `actorRole`: String (z.B. „Moderator“, „Band Drummer“).[1]
- `eventSummary`: Kurzbeschreibung / wichtiger Kontext.[1]
- `highLevelSchedule`: grober Ablauf mit wichtigen Blöcken (ohne minutengenaue Zeiten).[1]
- `dressCode`: Text + evtl. Icons.[1]
- `contacts`: Liste `[{ name, role, phone, isPrimaryContact }]`.[1]
- `locationInfo`: Adresse, grobe Venue‑Infos, Backstage‑Zugang, Treffpunkte.[1]
- `travelAndStay?`: optional, Reisestatus, Unterkunft, Transport.[1]

**Actions / Events:**

- `onOpenDayPlan()` → Router: wechselt in `ActorDayPlan` (falls `DAY_OF_EVENT`, sonst Hinweis „Tagesplan wird am Eventtag freigeschaltet“).[1]
- `onOpenDocs()` → `ActorDocs` (Briefing, Skript, Medienfreigaben, Sicherheitsregeln).[1]

***

### 2. Screen: `ActorDayPlan` (State: `DAY_OF_PRESHOW`)

**Zweck:** „Mein Tag“ – zentrale Ansicht am Eventtag.[1]

**Props:**

- `callTime`: Zeit.[1]
- `slots[]`: Liste mit Einträgen `{ type: "PROBE" | "SHOW" | "STYLING" | "MEETING" | "BREAK", start, end, location, zone, isCurrent, isNext }`.[1]  
- `realTimeChanges[]`: Liste von Planänderungen mit Timestamp (für Änderungshistorie).[1]
- `nextSlotCountdown`: Sekunden/Minuten bis nächstem Einsatz.[1]
- `checkinStatus`: `"NOT_CHECKED_IN" | "CHECKED_IN"`.[1]  
- `readOnly`: falls Event noch nicht offiziell freigegeben ist.[1]

**Actions / Events:**

- `onCheckIn()` → triggert `CHECKIN_PERFORMED` + Backend‑Update (Ankunft bestätigen).[1]
- `onOpenMap(slotId)` → öffnet Backstage‑/Treffpunkt‑Wegbeschreibung.[1]
- `onOpenStatusPanel()` → `ActorStatusPanel`.[1]
- `onOpenBreakInfo()` → Essens- und Pauseninfos (z.B. embedded Catering‑Slot für Actor).[1]

**Notifications‑Verhalten:**

- Push: „Call Time in 60/30/10 Minuten“ mit Deep‑Link in `ActorDayPlan`.[1]

***

### 3. Screen: `ActorStatusPanel` (States: `DAY_OF_PRESHOW` und `LIVE_ON_SHOW`)

**Zweck:** Schnellstatus für Supervisor + Leitstand, ohne viel UI‑Lärm.[1]

**Props:**

- `currentStatus`: `"OFFLINE" | "ON_THE_WAY" | "CHECKED_IN" | "READY" | "IN_MASK" | "BACKSTAGE" | "ON_POSITION" | "NOT_AVAILABLE"`.[1]  
- `lateFlag`: Boolean (hat Verspätung gemeldet).[1]
- `assignedSupervisor`: `{ name, contactOptions }`.[1]

**Actions / Events:**

- `onSetStatus(newStatus)`  
  - Erlaubte Buttons (konfigurierbar per Event):  
    - „Ankunft bestätigen“ (→ CHECKED_IN).[1]
    - „Ich bin bereit“ (→ READY).[1]
    - „In Maske“, „Im Backstage“, „Auf Position“, „Nicht verfügbar“.[1]
- `onReportDelay(reason, eta?)` → „Verspätung melden“.[1]
- `onCheckOut()` → Check‑out nach letzter Aktion.[1]

Du kannst hier bewusst nur 3–4 Hauptbuttons zeigen und Rest in ein „Mehr“-Menü legen, um die „extrem reduzierte Ansicht“ einzuhalten.[1]

***

### 4. Screen: `ActorLiveCueOverlay` (State: `LIVE_ON_SHOW`)

**Zweck:** Call- und Cue‑System; hat Vorrang vor allem anderen, wenn aktiv.[1]

**Props:**

- `activeCue?`: `{ type: "GET_READY" | "GO_TO_POSITION" | "DELAY" | "CHANGE_OF_PLAN", message, effectiveAt, requiresAck: boolean }`.[1]  
- `nextCuePreview?`: kurzer Text/Badge für „sichtbarer nächster Cue“.[1]

**Actions / Events:**

- `onAckCue(cueId)` → Pflichtbestätigung bei wichtigen Calls.[1]
- `onOpenDetails()` → blättert zum Kontext im `ActorDayPlan` (Slot + Location).[1]

**Trigger:**

- Autogeöffnet per `CUE_RECEIVED` + `requiresAck`.[1]

***

### 5. Screen: `ActorSupervisorComms` (States: `DAY_OF_PRESHOW`, `LIVE_ON_SHOW`)

**Zweck:** Minimal‑Kommunikation mit Supervisor, stark templatebasiert.[1]

**Props:**

- `supervisor`: `{ name, role, contactOptions }`.[1]
- `quickActions[]`:  
  - „Rückfrage“  
  - „Problem melden“  
  - „Verspätung melden“  
  - „Verfügbarkeit ändern“  
  - „Notfallkontakt auslösen“.[1]

**Actions / Events:**

- `onSendQuickAction(type, optionalMessage, optionalPhoto)` → erzeugt strukturierte Meldung beim Supervisor/Leitstand.[1]

Du kannst optional ein sehr reduziertes Chat‑Log (nur System + eigene gesendete Meldungen) anzeigen, aber keine volle Chat‑App.[1]

***

### 6. Screen: `ActorDocs` (alle States, aber sekundär)

**Zweck:** Rollenbezogene Informationen / Dokumente.[1]

**Props:**

- `briefingDoc`  
- `scriptDoc` / Ablauf  
- `safetyDoc`  
- `mediaConsentDoc`  
- `locationHintsDoc`  
- `wardrobeInfoDoc`.[1]

**Features:**

- Nur Read‑only, offline‑fähig.[1]
- „Pin“ für Favoriten (z.B. Sicherheitsregeln).[1]

***

### 7. Screen: `ActorPersonalRequirements` (meist Pre‑Event / Preshow)

**Zweck:** Persönliche Anforderungen & Logistik.[1]

**Props:**

- `allergiesAndDiet`.[1]
- `costumeEquipmentNeeds`.[1]
- `travelStatus`, `accommodation`, `transportDetails`, `wardrobeRoom`.[1]

Rein informativ für Actor; editierbar eher durch Admin/Produktionsbüro.

***

### 8. Screen: `ActorPostShowInfo` (State: `POST_SHOW`)

**Zweck:** Sauberer Abschluss.[1]

**Props:**

- `wrapUpMessage` (Danke, Abbau‑Hinweise).[1]
- `transportBackInfo`.[1]
- `feedbackLink?`.[1]

Minimal, keine neuen komplexen Aktionen.

***




***

## Leitstand: Screen-/State-Flow

**States:**

1. Pre‑Event Setup  
2. Pre‑Show Monitoring  
3. Live Command Center  
4. Post‑Event Review[1]

### 1. Pre‑Event Setup (Leitstand)

**Entry:** Event angelegt, noch kein Live‑Betrieb.[1]

- Screen „Timeline & Roles“  
  - Master‑Zeitplan konfigurieren (Programmpunkte, Call Times, Puffer, Abhängigkeiten).[1]
  - Rollen und Rechte pro Event/Zonen setzen.[1]
  - Kritische Dokumente anhängen (Sicherheitskonzept, Lagepläne, Notfallprotokolle).[1]
- Hauptaktionen:  
  - Zeitplan validieren (Konfliktchecks, Pufferwarnungen).[1]
  - Test‑Broadcast an Supervisor senden („Run‑through morgen 10:00“).[1]

**Transition → Pre‑Show Monitoring:** Event auf „Aufbau gestartet“ setzen.[1]

### 2. Pre‑Show Monitoring (Leitstand)

**Entry:** Aufbau läuft, Show noch nicht gestartet.[1]

- Screen „Command‑Center Dashboard – Aufbau“  
  - Gesamtstatus, Ampel je Team/Zone, kritische Aufgaben, offene Incidents, Check‑in‑Quote, Verzögerungen.[1]
- Screen „Live‑Monitoring – Aufbau“ (optional zweiter Monitor)  
  - Aufgabenfortschritt, Supervisor‑Status, Systemwarnungen, Netzwerk/Sync, Spät‑/Fehlend‑Markierungen.[1]

**Hauptaktionen:**

- Aufgabenbündel an Supervisor dispatchen (z.B. „Bühne A Aufbau“).[1]
- Incidents kategorisieren (Technik, Sicherheit etc.) und Eskalationen konfigurieren.[1]
- Timeline feinjustieren, kleinere Verzögerungen propagieren.[1]

**Transition → Live Command Center:** Eventstatus „Show läuft“.[1]

### 3. Live Command Center (Leitstand)

**Entry:** Show läuft, hohe Dynamik.[1]

- Hauptscreen „Command‑Center – Live“  
  - „Nächste 15 Minuten“-Vorschau, kritische Aufgaben, offene Incidents mit SLA‑Timer, Actor‑Bereitschaft, Cateringstatus, Kommunikationsstatus.[1]
- Side‑Panel „Incident‑Control“  
  - Detailansicht eines Vorfalls mit Maßnahmenliste, Eskalationskette, Zeitlimit‑Anzeige, Abschlussfreigabe.[1]
- Timeline‑Overlay „Master‑Timeline“  
  - Programmänderungen, Verzögerungen, automatische Info an betroffene Rollen.[1]

**Hauptaktionen:**

- Incidents priorisieren, Eskalation an Security/Technik.[1]
- Ad‑hoc‑Broadcasts senden (z.B. „Programmpunkt X +10 Minuten“).[1]
- Aufgaben umverteilen (Reassignment) bei Ausfällen.[1]

**Transition → Post‑Event:** Eventstatus „Beendet“.[1]

### 4. Post‑Event Review (Leitstand)

- Screen „Reporting & Lessons Learned“  
  - Eventprotokoll, Task‑Completion‑Rate, Incident‑Auswertung, Reaktionszeiten, Check‑in‑Statistiken, Catering‑Abweichungen, Actor‑Pünktlichkeit, Exporte.[1]

**Aktionen:**

- Berichte exportieren und Lessons‑Learned dokumentieren.[1]

***

## Supervisor: Screen-/State-Flow

**States:**

1. Pre‑Event Vorbereitung  
2. Pre‑Show / Aufbau  
3. Live‑Runde  
4. Schicht‑Übergabe / Nachbereitung[1]

### 1. Pre‑Event Vorbereitung (Supervisor)

- Screen „Team & Area Setup“  
  - Zugewiesenes Team, Zonen, Materialstatus sichten.[1]
  - Relevante Checklisten (Aufbau, Sicherheit, Pre‑Show) für später vorbereiten.[1]

**Transition → Pre‑Show:** Schichtbeginn + Eventstatus „Aufbau“.[1]

### 2. Pre‑Show / Aufbau (Supervisor)

**Home‑Screen:** „Team‑Dashboard – Aufbau“

- Komponenten:  
  - Aktive/abwesende Personen, Aufgabenstatus, Zonenstatus, offene Probleme, Prioritätenliste, Materialstatus.[1]

**Hauptaktionen:**

- Aufgaben vom Leitstand annehmen, an Team delegieren, Status setzen.[1]
- „Rundgang starten“ → öffnet passende Checkliste (Aufbau/Sicherheit/Raum/Technik).[1]
- Probleme per Eskalationsfunktion an Leitstand melden (Foto, Kommentar).[1]

**Transition → Live‑Runde:** Event „Show läuft“.[1]

### 3. Live‑Runde (Supervisor)

**Home‑Screen:** „Heute & Jetzt“

- Abschnitt „Jetzt“: akute Aufgaben + Incidents im eigenen Bereich.[1]
- Abschnitt „Als Nächstes“: anstehende Programmpunkte + Aufgaben.[1]
- Abschnitt „Teamstatus“: Verfügbarkeit, Pausen, Überlastung.[1]

**Team‑Kommunikation:** eingebetteter Bereich oder eigener Tab  

- Team‑Chat, Broadcast ans Team, stille Updates für Statusänderungen, Rückfrage an Leitstand.[1]

**Hauptaktionen:**

- Aufgabenstatus pflegen, Pausen koordinieren, Ersatzpersonen anfordern, kurzfristig umverteilen.[1]
- Bei Problemen „Eskalieren“ direkt aus Aufgabe/Checklisteneintrag.[1]

### 4. Schicht‑Übergabe / Nachbereitung (Supervisor)

- Screen „Übergabe & Nachbericht“  
  - Offene Aufgaben, kritische Incidents, Checklisten‑Status, Notizen.[1]

**Aktion:**

- Übergabeprotokoll für nächsten Supervisor ausfüllen, ggf. Post‑Event‑Check durchführen.[1]

***

## Actor: Screen-/State-Flow

**States:**

1. Pre‑Event (Info‑Pull)  
2. Eventtag Pre‑Show  
3. Live‑On‑Show  
4. Post‑Show / Exit[1]

### 1. Pre‑Event (Actor)

- Screen „Event‑Overview“  
  - Kurzbriefing: Rolle, grober Programmablauf, Dresscode, Ansprechpartner, Location‑Info.[1]
  - Reise/Unterkunft/Transport, falls relevant.[1]

**Aktion:** „Zum Tagesplan“ führt auf Pre‑Show‑Ansicht (vorerst leer oder mit „Noch nicht freigegeben“).[1]

### 2. Eventtag Pre‑Show (Actor)

**Home‑Screen:** „Mein Tag“

- Persönlicher Tagesplan mit: Call Time, Proben, Styling/Maske, Treffpunkte, Pausen.[1]
- Countdown bis nächstem Termin, farblich hervorgehoben.[1]
- Prominenter „Ankunft“/Check‑in‑Button.[1]

**Status‑Panel:**

- Quick‑Status: „Bereit“, „In Maske“, „Im Backstage“, „Auf Position“, „Nicht verfügbar“, Verspätung melden, Check‑out.[1]

**Actions:**

- „Wo muss ich hin?“ → Karten/Wegbeschreibung zur nächsten Location.[1]
- „Briefing/Skript“ → Dokumentenansicht (Read‑only).[1]

**Transition → Live‑On‑Show:** Nächster Programmpunkt aktiv (z.B. Auftritt).[1]

### 3. Live‑On‑Show (Actor)

**Home‑Screen bleibt „Mein Tag“, aber UI fokussiert Calls/Cues.**

- Oben: Nächster Cue („In 3 Minuten bereitmachen“, „Auf Position“), mit Bestätigungsbutton.[1]
- Mitte: Timeline mit nur 1–2 nächsten Slots.[1]
- Unten: Schnell‑Buttons für Supervisor‑Kontakt (Rückfrage, Problem, Verspätung, Notfall).[1]

**Push‑Verhalten:**

- Kritische Calls als Vollbild‑Overlay mit Pflichtbestätigung.[1]

### 4. Post‑Show / Exit (Actor)

- Screen „Danke & Infos“  
  - Letzte Hinweise (Transport zurück, Garderobe, ggf. Feedback‑Link).[1]

Minimal gehalten, damit der Actor mental rauskommt.[1]

***

## Catering: Screen-/State-Flow

**States:**

1. Pre‑Event Planung  
2. Liefer‑/Aufbauphase  
3. Live‑Ausgabe  
4. Nachbereitung / Analyse[1]

### 1. Pre‑Event Planung (Catering)

- Screen „Menü & Mengenplanung“  
  - Menüplan, Mahlzeiten nach Zeitfenstern, Portionszahlen pro Personengruppe, Sonderkost & Allergene, VIP/Actor‑Requirements.[1]

**Aktion:** Forecast speichern → wird später im Dashboard als Sollwerte genutzt.[1]

### 2. Liefer‑/Aufbauphase (Catering)

**Screen:** „Logistik & Wareneingang“

- Lieferzeiten, Lieferanten, Lieferzonen, Wareneingang, Temperaturkontrolle, Übergabestatus, Foto‑Nachweis, Reklamation.[1]

**Aktion:**

- „Lieferung eingetroffen“ → Restmengen und Ausgabeplanung updaten.[1]

### 3. Live‑Ausgabe (Catering)

**Home‑Screen:** „Catering‑Dashboard – Live“

- Aktuelle Meal Period.[1]
- Zahlen: Gäste, Crew, VIP, Actors, Soll/Ist‑Mengen, Restmengen, Engpässe, Allergene, Sonderwünsche.[1]
- Offene Aufgaben (z.B. „Buffet in Zone B auffüllen“).[1]

**Subscreen:** „Ausgabe & Slots“

- Essensslots, Gruppenfreigabe, QR‑/Namensprüfung, „Hat gegessen“-Status, Warteschlangenstatus, Kapazitätswarnungen, VIP‑/Actor‑Priorisierung.[1]

**Aktionen:**

- „Engpass melden“, „Nachschub anfordern“, „Menüänderung senden“ (Broadcast an Leitstand/Supervisor).[1]

### 4. Nachbereitung / Analyse (Catering)

- Screen „Verbrauch & Waste“  
  - Restmengen, Schwund, Waste‑Tracking, Post‑Event‑Verbrauchsanalyse.[1]

**Aktion:** Daten exportieren, mit Leitstand‑Reporting verknüpfen.[1]

***



***

## Gemeinsames Modell: Rollen, Phasen, Fragen

Aus dem Dokument fallen klar diese Rollen heraus: Leitstand, Supervisor, Actor, Catering, Admin (über Rollen/Rechte), plus globale QoL‑Features für alle.[1] Jede Rolle bewegt sich grob durch vier Phasen:

- Vor dem Event: Konfiguration, Planung, Briefings.
- Aufbau/Pre‑Show: Check‑ins, Setup, letzte Checks.
- Live‑Betrieb: Echtzeitsteuerung, Störungen, schnelle Entscheidungen.
- Nachbereitung: Reporting, Lessons Learned, Doku.

Wichtig ist: Jede Rolle hat pro Phase nur 2–3 dominante Fragen; alles andere sind unterstützende Funktionen, die du „andockst“, aber nicht in die erste Reihe stellst.[1]

Beispiele für Leitfragen pro Rolle:

- Leitstand: „Wo brennt es?“, „Wer kümmert sich?“, „Was passiert als Nächstes?“[1]
- Supervisor: „Wie geht es meinem Team?“, „Welche Aufgaben sind kritisch?“, „Wer fehlt?“[1]
- Actor: „Wann und wo muss ich als Nächstes sein?“, „Bin ich rechtzeitig / bereit?“[1]
- Catering: „Reichen Menge und Zeitplan?“, „Wo gibt es Engpässe?“[1]

Alles, was du im Dokument hast, lässt sich diesen Fragen und Phasen zuordnen.

***

## Globale Basis: Was immer da sein muss

Die globalen Features sind die Infrastruktur – sie sind immer vorhanden, müssen aber nicht immer „oben liegen“.[1] Wichtige globale Bausteine:

- Event‑Dashboard / Lagebild: Live‑Status, Timeline, Aufgaben nach Priorität, Ampelsystem, Anwesenheiten, Kommunikationsstatus.[1]
- Rollen- und Rechteverwaltung inkl. temporärer Zugänge, Sichtbarkeit nach Zone/Team, Audit‑Log, Notfall‑Override.[1]
- Aufgaben- und Dispatch‑System mit Status, Deadlines, Anhängen, Eskalation, Übergabe.[1]
- Live‑Kommunikation (rollenbasierte Channels, Broadcasts, kritische Pushes, Lesestatus, Vorlagen).[1]
- Event‑Zeitplan / Run of Show mit Master‑Timeline, Rollenansichten, Verzögerungsanzeige, „Was ist als Nächstes?“-View.[1]
- Check‑in/Check‑out, Anwesenheiten, Schichtbeginn/ende, Ersatzperson‑Zuweisung.[1]
- Location-/Zonenverwaltung mit Venue‑Plan, Zonen, Sperrbereichen, Notausgängen.[1]
- Incident‑ und Eskalationsmanagement inkl. Kategorien, Schweregrad, Eskalationsketten, Abschlussberichten.[1]
- Dokumenten- und Wissenshub (Briefings, Sicherheitskonzepte, Kontaktlisten, Notfallprotokolle) mit Versionierung und Offline.[1]
- Offline-/Sync‑Funktionen mit Konfliktlösung, priorisiertem Sync für kritische Meldungen.[1]

UX‑Konsequenz: Diese Dinge müssen als Konzepte konsistent sein (Tasks, Incidents, Timeline, Roles, Zones), aber du zeigst stets nur den Ausschnitt, der zur Rolle und Phase passt.

***

## Leitstand: Phasen und Oberflächen

Leitstand ist „Command Center“ – dort darf es komplexer sein, aber strukturiert. Dein Dokument definiert bereits eine Leitstand‑Sicht mit Command‑Center‑Dashboard, Live‑Monitoring, Dispatch, Incident‑Control, Master‑Timeline, Kommunikationszentrale und Reporting.[1]

### Leitstand vor dem Event

Primär:

- Master‑Timeline vorbereiten und validieren (Programm, Call Times, Puffer, Abhängigkeiten).[1]
- Rollen/Rechte event‑spezifisch setzen, Zonen definieren, Checklisten und Notfallprotokolle laden.[1]

Features im Vordergrund:

- Master‑Zeitplan + Versionierung.[1]
- Rollen-/Rechteverwaltung pro Event.[1]
- Dokumentenhub (Briefings, Sicherheitskonzepte, Lagepläne).[1]

Alles andere (Live‑Monitoring, Incident‑Control) ist in dieser Phase sekundär.

### Leitstand im Aufbau/Pre‑Show

Primärfrage: „Sind wir on track für Show‑Start?“[1]

Vorne:

- Command‑Center‑Dashboard mit Ampelstatus pro Team/Zone, kritische Aufgaben, aktuelle Verzögerungen, Personalverfügbarkeit.[1]
- Live‑Monitoring: Aufgabenfortschritt, Check‑in‑Quote, Supervisor‑Status.[1]

Sekundär (per Tabs/Drawer):

- Incident‑Übersicht, falls beim Aufbau schon Probleme gemeldet sind.[1]
- Kommunikationszentrale (Broadcasts an Supervisor, Reminder für Call Times).[1]

### Leitstand im Live‑Betrieb

Jetzt brauchst du maximale Situational Awareness.[1]

Fokus‑Views:

- Lagebild + Live‑Monitoring: Offene Incidents, kritische Aufgaben, Verzögerungen, Eskalationen, Netzwerk-/Sync‑Status.[1]
- Incident‑Control mit Eskalationsketten, SLA/Zeitanzeige, Maßnahmenverfolgung.[1]
- Master‑Timeline‑Steuerung: Programmänderungen, Verzögerungen propagieren, abhängige Rollen automatisch informieren.[1]

Dispatch & Kommunikation docken sich als „Aktionen“ direkt an Incidents/Aufgaben an (z.B. Seitenpaneel statt eigene App‑Sektion).[1]

### Leitstand in der Nachbereitung

Primär sind Reporting & Lessons Learned.[1]

Fokus:

- Eventprotokoll, Task‑Completion‑Rate, Incident‑Auswertung, Reaktionszeiten, Check‑in‑Statistiken, Catering‑Abweichungen, Actor‑Pünktlichkeit.[1]
- Export als PDF/CSV und Lessons‑Learned‑Bereich.[1]

Live‑Panels werden hier zu „Analysen“ (z.B. gleiche Komponenten, andere Filter).

***

## Supervisor: Bridge zwischen Leitstand und Ausführung

Supervisor ist die Brücke – sein Fokus ist Team‑Gesundheit, Aufgaben und Kommunikation.[1]

### Supervisor vor dem Event

Fokus:

- Team- und Bereichsübersicht: zugewiesenes Team, Zonen, Materialstatus.[1]
- Vor-Ort‑Checklisten (Aufbau‑, Sicherheits‑, Raum-, Technik‑Checks) als vorbereitete Pakete für den Tag X.[1]

Features wie Eskalationsfunktion und Schichtsteuerung sind da, aber werden erst im Live‑Kontext dominiert.[1]

### Supervisor im Aufbau/Pre‑Show

Primärfragen: „Wer ist da?“, „Ist mein Bereich bereit?“[1]

Front‑View:

- Team‑Übersicht: aktive/abwesende Personen, Aufgabenstatus, Zonenstatus, offene Probleme, Prioritätenliste.[1]
- Schicht- und Personalsteuerung: Check‑in prüfen, Ersatzpersonen anfordern, Verfügbarkeit, Überlastung, Pausenkoordination.[1]

Vor‑Ort‑Checklisten (Aufbau, Sicherheit, Pre‑Show) sind direkt als „Start Rundgang“ integriert.[1]

### Supervisor im Live‑Betrieb

Fokus:

- „Meine nächsten Aufgaben“ + Team‑Status in einer kombinierten Ansicht.[1]
- Team‑Kommunikation (Team‑Chat, Broadcasts, Schnellantworten) mit ruhigen Updates statt Chat‑Flut.[1]

Eskalationsfunktion hängt direkt an Aufgaben/Incidents: Problem melden, Priorität setzen, Leitstand benachrichtigen, Foto/Kommentar, Status verfolgen.[1]

### Supervisor Nachbereitung

Relevanter Ausschnitt:

- Übergabeprotokoll für nächste Schicht/Supervisor + Vor‑Ort‑Notizen.[1]
- Zusammenfassung von Checklisten und Incidents seines Bereichs für den Lessons‑Learned‑Prozess.[1]

***

## Actor: Extrem reduzierte, zeit- und ortsbezogene Sicht

Für Actors willst du maximale Reduktion, dein Dokument betont explizit „extrem reduzierte Ansicht: nur relevante Infos“.[1]

### Actor vor dem Event

Eher passiv:

- Grundbriefing: Rolle, Skript/Ablauf, Dresscode, Ansprechpartner, Location‑Hinweise.[1]
- Reisedaten, Unterkunft/Transport, ggf. persönliche Anforderungen (Allergien, Kostüm‑Bedarf).[1]

Das kann in einer „Event‑Overview“ plus „Travel“ Sektion liegen, aber nicht im Live‑Home.

### Actor am Eventtag / Pre‑Show

Primärfragen: „Wann/wo ist meine nächste Probe/Auftritt?“[1]

Home‑Screen:

- Persönlicher Tagesplan mit Call Time, Proben, Styling/Maske, Treffpunkte, Wartezonen, Pausen, Änderungen in Echtzeit und Countdown bis zum nächsten Einsatz.[1]
- Check‑in und Bereitschaftsstatus: Ankunft bestätigen, „Bereit“, „In Maske“, „Im Backstage“, „Auf Position“, „Nicht verfügbar“, Verspätung melden, Check‑out.[1]

Alles andere hängt daran (z.B. „Wo muss ich hin?“ öffnet Wegbeschreibung zur nächsten Station).[1]

### Actor im Live‑Betrieb

Fokus:

- Call- und Cue‑System: Push bei „Bereitmachen“, „Auf Position“, Verzögerung, Ablaufänderung, mit Bestätigungspflicht.[1]
- Kommunikation mit Supervisor: Rückfrage, Problem, Verspätung, Verfügbarkeit, Notfallkontakt, über schnelle Statusbuttons.[1]

Dokumente (Skript, Medienfreigaben, Sicherheitsregeln) sind präsent, aber eher als „Dokumente“-Tab, nicht im Hauptstrom.[1]

### Actor Post‑Event

Minimal:

- Ggf. Feedback / Nachbesprechungsinfos, Reisedetails für Abreise.  
- Keine volle Ops‑App nötig.

***

## Catering: Operativer Fokus auf Mengen, Zeitfenster, Allergien

Catering hat eine eigene kleine „Ops‑Welt“, stark zahlen- und statusgetrieben.[1]

### Catering vor dem Event

Fokus:

- Menü- und Bestellverwaltung: Menüplan, Mahlzeiten pro Zeitfenster, Portionszahlen, Sonderkost, Allergene, VIP/Actor‑Anforderungen.[1]
- Mengen- und Forecast‑Setup pro Personengruppe.[1]

Das ist mehr Backoffice; UI kann eher desktop/web sein.

### Catering im Aufbau/Pre‑Show

Primär:

- Liefer- und Logistikmanagement: Lieferzeiten, Lieferantenkontakte, Lieferzone, Wareneingang, Temperaturkontrolle, Übergabestatus.[1]
- Catering‑Dashboard mit Meal Period, geplanten Mengen, Lieferstatus.[1]

### Catering im Live‑Betrieb

Home‑Screen:

- Catering‑Dashboard: aktuelle Meal Period, Gäste-/Crew-/VIP-/Actor‑Zahlen, Soll/Ist‑Mengen, Engpässe, Allergene, Sonderwünsche, offene Aufgaben.[1]
- Ausgabe- und Slot‑System: Essensslots, Gruppenfreigabe, QR‑/Namensprüfung, „Hat gegessen“-Status, Warteschlangenstatus, Kapazitätswarnung, VIP‑Priorisierung.[1]

Engpass-/Verspätungs‑Kommunikation hängt direkt an diesem Dashboard: „Engpass melden“, „Verspätung melden“, „Nachschub anfordern“.[1]

### Catering Nachbereitung

Fokus:

- Restmengen, Waste‑Tracking, Post‑Event‑Verbrauchsanalyse.[1]

Das ist wieder eher Reporting‑UI.

***

## Admin / Rollen- und Rechte: Vor allem Pre‑Event & Sonderfälle

Die Rollen- und Rechteverwaltung ist primär eine Admin‑Domäne, mit Ausnahmen für temporäre Zugänge und Notfall‑Overrides.[1]

Zeitliche Bedeutung:

- Vor dem Event: Rollen (Leitstand, Supervisor, Actor, Catering, Admin), Rechte pro Event, Sichtbarkeit nach Zonen/Teams, Rechtevererbung, Gast-/Freelancer‑Zugänge konfigurieren.[1]
- Während des Events: Temporäre Zugänge vergeben, Notfall‑Override für Leitstand/Admin, Audit‑Log für kritische Änderungen.[1]

Im Live‑Alltag sollte das UI stark reduziert sein (Preset‑Rollenmuster, schnelle temporäre Berechtigungen), damit es nicht stört.

***

## QoL: Wie du „nur das Nötige“ auslieferst

Dein QoL‑Kapitel ist im Grunde eine UX‑Checkliste für „Reibung rausnehmen ohne Informationen zu verstecken“.[1] Die wichtigsten Patterns:

### „Meine nächsten Aufgaben“ & „Was ist jetzt wichtig?“

Du nennst explizit Navigationselemente wie „Meine nächsten Aufgaben“, „Was ist jetzt wichtig?“, Favoriten, rollenbasierte Startseite, „Zuletzt geöffnet“.[1]

Konkreter Pattern:

- Home je Rolle = 3 Blöcke: „Jetzt“, „Als Nächstes“, „Probleme“ (Incidents), gefiltert auf die Rolle.[1]
- Globaler Suche/Filter, aber standardmäßig nur eigene Zone/Rolle aktiv.[1]

### Notifications ohne Overload

Du definierst priorisierte Pushs, stumme Updates, Snooze, rollenbezogene Notification‑Regeln, Zusammenfassungen statt Spam, Eskalation bei keiner Reaktion.[1]

Konsequenz:

- Für Actor nur wenige, hochpriorisierte Calls, alles andere als Digest.[1]
- Leitstand sieht volle Historie, aber mit klarer Trennung Info/Warnung/Notfall.[1]

### Progressive Disclosure statt Verstecken

Du hast viele Sicherheitsmechanismen: Inline‑Validierung, Warnungen bei widersprüchlichen Zeiten, Undo, Versionierung, Papierkorb, Plausibilitätschecks.[1]

UX‑Nutzung:

- Standardansichten zeigen nur Kernfelder; fortgeschrittene Optionen (z.B. Eskalationskette, SLA‑Details, Export) hinter „Details anzeigen“ oder Sekundär‑Tabs, nicht in separaten Feature‑Silots.[1]

### Personalisierung & Accessibility

Personalisierung (eigene Startansicht, bevorzugte Sprache, Dark Mode, große Schrift, eigene Benachrichtigungsregeln, „Nicht stören“-Modus mit Notfallausnahme) plus WCAG‑orientiertes Design, große Touch‑Ziele, klare Fokuszustände, keine reine Farbcodierung.[1]

Das unterstützt dein Ziel „entspannter Ablauf“, weil Nutzer ihre kognitive Last und Benachrichtigungsintensität selbst justieren können, ohne Extrainformationen zu verlieren.[1]

***

## Konkrete Info‑Architektur (Kurzfassung)

Zum Ableiten deiner UI‑Struktur kannst du die Must‑Haves in drei Layer aufteilen:

1. **Core‑Views pro Rolle/Phase**  
   - Leitstand:  
     - Pre‑Event: Timeline‑Setup + Rollen/Rechte.  
     - Live: Lagebild + Incidents + Dispatch in einem Command‑Center.[1]
   - Supervisor:  
     - Live: Team‑Dashboard (Personen + Aufgaben + Checklisten) + Team‑Chat.[1]
   - Actor:  
     - Live: persönliche Timeline + Status + Call/Cue‑Overlay.[1]
   - Catering:  
     - Live: Catering‑Dashboard + Ausgabe‑Slots + Engpass‑Buttons.[1]

2. **Kontext‑Aktionen an Objekte gebunden**  
   - Aufgaben, Incidents, Schedule‑Einträge sind die zentralen Objekte; von dort aus erreichst du Anhänge, Fotos, Notizen, Eskalationen, Delegation, statt dafür eigene „Module“ aufzuziehen.[1]

3. **System‑Ebene**  
   - Rechte, Dokumentenhub, Offline/Sync, Audit‑Logs, Reporting – immer verfügbar, aber eher über Settings/Backoffice‑Bereiche oder sekundäre Tabs, nicht auf dem primären Home‑Screen, außer für Leitstand‑Reporting nach Event.[1]


***



