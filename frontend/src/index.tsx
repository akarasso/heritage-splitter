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
import CollectionNew from "./pages/project/CollectionNew";
import CollectionLayout from "./pages/project/CollectionLayout";
import CollectionOverview from "./pages/project/CollectionOverview";
import CollectionAllocations from "./pages/project/CollectionAllocations";
import CollectionRepartition from "./pages/project/CollectionRepartition";
import CollectionSimulation from "./pages/project/CollectionSimulation";
import CollectionNfts from "./pages/project/CollectionNfts";
import CollectionDiscussion from "./pages/project/CollectionDiscussion";
import CollectionIntegration from "./pages/project/CollectionIntegration";
import CollectionHistory from "./pages/project/CollectionHistory";
import ProjectCollections from "./pages/project/ProjectCollections";
import ShowroomList from "./pages/showroom/ShowroomList";
import ShowroomNew from "./pages/showroom/ShowroomNew";
import ShowroomLayout from "./pages/showroom/ShowroomLayout";
import ShowroomOverview from "./pages/showroom/ShowroomOverview";
import ShowroomDocuments from "./pages/showroom/ShowroomDocuments";
import ShowroomListings from "./pages/showroom/ShowroomListings";
import ShowroomIntegration from "./pages/showroom/ShowroomIntegration";

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
        <Route path="/collections" component={ProjectCollections} />
        <Route path="/collections/new" component={CollectionNew} />
        <Route path="/collections/:collectionId" component={CollectionLayout}>
          <Route path="/" component={CollectionOverview} />
          <Route path="/allocations" component={CollectionAllocations} />
          <Route path="/repartition" component={CollectionRepartition} />
          <Route path="/simulation" component={CollectionSimulation} />
          <Route path="/nfts" component={CollectionNfts} />
          <Route path="/discussion" component={CollectionDiscussion} />
          <Route path="/history" component={CollectionHistory} />
          <Route path="/integration" component={CollectionIntegration} />
        </Route>
      </Route>
      <Route path="/showroom" component={ShowroomList} />
      <Route path="/showroom/new" component={ShowroomNew} />
      <Route path="/showroom/sale/:slug" component={lazy(() => import('./pages/showroom/PublicShowroom'))} />
      <Route path="/showroom/:id" component={ShowroomLayout}>
        <Route path="/" component={ShowroomOverview} />
        <Route path="/listings" component={ShowroomListings} />
        <Route path="/integration" component={ShowroomIntegration} />
        <Route path="/documents" component={ShowroomDocuments} />
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
