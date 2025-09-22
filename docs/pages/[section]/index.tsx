import { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { section } = context.params as { section: string };

  // special cases
  if (section === "intro") {
    return {
      redirect: {
        destination: "/intro/introduction",
        permanent: true,
      },
    };
  }

  if (section === "contribute") {
    return {
      redirect: {
        destination: "/contribute/contributing",
        permanent: true,
      },
    };
  }

  // default rule → /:section/overview
  return {
    redirect: {
      destination: `/${section}/overview`,
      permanent: true,
    },
  };
};

export default function SectionRedirect() {
  return null;
}
