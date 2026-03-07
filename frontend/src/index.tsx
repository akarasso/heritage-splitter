/* @refresh reload */
import { render } from "solid-js/web";
import { lazy } from "solid-js";
import { Router, Route } from "@solidjs/router";
import App from "./App";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import ProjectNew from "./pages/ProjectNew";
import ProjectLayout from "./pages/project/ProjectLayout";
import ProjectOverview from "./pages/project/ProjectOverview";
import ProjectDiscussion from "./pages/project/ProjectDiscussion";
import ProjectActivity from "./pages/project/ProjectActivity";
import ProjectDocuments from "./pages/project/ProjectDocuments";
import WorkNew from "./pages/project/WorkNew";
import WorkLayout from "./pages/project/WorkLayout";
import WorkOverview from "./pages/project/WorkOverview";
import WorkAllocations from "./pages/project/WorkAllocations";
import WorkRepartition from "./pages/project/WorkRepartition";
import WorkSimulation from "./pages/project/WorkSimulation";
import WorkNfts from "./pages/project/WorkNfts";
import WorkDiscussion from "./pages/project/WorkDiscussion";
import WorkIntegration from "./pages/project/WorkIntegration";
import WorkHistory from "./pages/project/WorkHistory";
import ProjectNftCollections from "./pages/project/ProjectNftCollections";

import ProfileEdit from "./pages/ProfileEdit";
import Onboarding from "./pages/Onboarding";
import VerifyNft from "./pages/VerifyNft";
import VerifyDocument from "./pages/VerifyDocument";
import Activity from "./pages/Activity";
import Documentation from "./pages/Documentation";
import "./index.css";

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Landing} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/projects/new" component={ProjectNew} />
      <Route path="/projects/:id" component={ProjectLayout}>
        <Route path="/" component={ProjectOverview} />
        <Route path="/discussion" component={ProjectDiscussion} />
        <Route path="/documents" component={ProjectDocuments} />
        <Route path="/activity" component={ProjectActivity} />
        <Route path="/works/nft" component={ProjectNftCollections} />
        <Route path="/works/new" component={WorkNew} />
        <Route path="/works/:workId" component={WorkLayout}>
          <Route path="/" component={WorkOverview} />
          <Route path="/allocations" component={WorkAllocations} />
          <Route path="/repartition" component={WorkRepartition} />
          <Route path="/simulation" component={WorkSimulation} />
          <Route path="/nfts" component={WorkNfts} />
          <Route path="/discussion" component={WorkDiscussion} />
          <Route path="/history" component={WorkHistory} />
          <Route path="/integration" component={WorkIntegration} />
        </Route>
      </Route>
      <Route path="/profile/edit" component={ProfileEdit} />
      <Route path="/verify/document" component={VerifyDocument} />
      <Route path="/verify/:contract/:token" component={VerifyNft} />
      <Route path="/activity" component={Activity} />
      <Route path="/docs" component={Documentation} />
      <Route path="/sale/:slug" component={lazy(() => import('./pages/PublicSale'))} />
    </Router>
  ),
  document.getElementById("root")!
);
